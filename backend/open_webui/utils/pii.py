from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


import logging
import sys

from open_webui.env import SRC_LOG_LEVELS, GLOBAL_LOG_LEVEL

logging.basicConfig(stream=sys.stdout, level=GLOBAL_LOG_LEVEL)
log = logging.getLogger(__name__)
log.setLevel(SRC_LOG_LEVELS["MAIN"])


def _check_overlap(range1: tuple[int, int], range2: tuple[int, int]) -> bool:
    """Check if two ranges overlap."""
    start1, end1 = range1
    start2, end2 = range2
    return start1 < end2 and start2 < end1


def _get_range_length(range_tuple: tuple[int, int]) -> int:
    """Get the length of a range."""
    return range_tuple[1] - range_tuple[0]


def _resolve_overlaps(
    replacements: list[dict], modifier_entities: set[str]
) -> list[dict]:
    """
    Resolve overlaps between replacements according to the specified rules:
    1. If overlap occurs between PII detection and modifier: ignore the PII detection
    2. If both are modifiers: take the longer one
    3. If same length: take the one occurring first in the text

    Args:
            replacements: List of replacement dictionaries with start_idx, end_idx, replacement, and source_entity
            modifier_entities: Set of entity names that are modifiers

    Returns:
            List of non-overlapping replacements
    """
    if len(replacements) <= 1:
        return replacements

    # Sort by start index to process in order
    sorted_replacements = sorted(replacements, key=lambda x: x["start_idx"])
    resolved = []

    for current in sorted_replacements:
        current_range = (current["start_idx"], current["end_idx"])
        current_is_modifier = current["source_entity"] in modifier_entities

        # Check for overlaps with already resolved replacements
        overlapping_indices = []
        for i, existing in enumerate(resolved):
            existing_range = (existing["start_idx"], existing["end_idx"])
            if _check_overlap(current_range, existing_range):
                overlapping_indices.append(i)

        if not overlapping_indices:
            # No overlaps, add current replacement
            resolved.append(current)
        else:
            # Handle overlaps
            should_add_current = True
            indices_to_remove = []

            for idx in overlapping_indices:
                existing = resolved[idx]
                existing_range = (existing["start_idx"], existing["end_idx"])
                existing_is_modifier = existing["source_entity"] in modifier_entities

                if current_is_modifier and not existing_is_modifier:
                    # Current is modifier, existing is not -> keep current, remove existing
                    indices_to_remove.append(idx)
                elif not current_is_modifier and existing_is_modifier:
                    # Current is not modifier, existing is -> keep existing, skip current
                    should_add_current = False
                    break
                elif current_is_modifier and existing_is_modifier:
                    # Both are modifiers -> take the longer one, if same length take first occurring
                    current_length = _get_range_length(current_range)
                    existing_length = _get_range_length(existing_range)

                    if current_length > existing_length:
                        # Current is longer -> keep current, remove existing
                        indices_to_remove.append(idx)
                    elif current_length < existing_length:
                        # Existing is longer -> keep existing, skip current
                        should_add_current = False
                        break
                    else:
                        # Same length -> take the one occurring first (existing wins)
                        should_add_current = False
                        break
                else:
                    # Neither is modifier -> this shouldn't happen in our use case, but handle gracefully
                    # Take the longer one, if same length take first occurring
                    current_length = _get_range_length(current_range)
                    existing_length = _get_range_length(existing_range)

                    if current_length > existing_length:
                        indices_to_remove.append(idx)
                    elif current_length <= existing_length:
                        should_add_current = False
                        break

            # Remove overlapping replacements that should be replaced
            for idx in sorted(indices_to_remove, reverse=True):
                resolved.pop(idx)

            # Add current replacement if it should be added
            if should_add_current:
                resolved.append(current)

    return resolved


def text_masking(
    text: str,
    pii_list: list[dict] | list[object],
    modifiers: list[dict | object] | None,
) -> str:
    """
    Mask the text based on the PII list.

    Replaces detected PII with labels in the format [{LABEL_ID}].
    For example, a person's name might be replaced with [{PERSON_1}].

    Args:
            text: The original text containing PII
            pii_list: List of dictionaries or PiiEntity objects containing PII information
                    Each item should have:
                    - 'type': The PII type (e.g., 'PERSON', 'EMAIL')
                    - 'label': The label to use for replacement (e.g., 'PERSON_1')
                    - 'occurrences': List of dictionaries/PiiOccurrence objects with 'start_idx' and 'end_idx'
            modifiers: List of dictionaries or Pydantic objects containing modifiers
                    Each item should have:
                    - 'action': The action to perform (e.g., 'mask', 'unmask')
                    - 'entity': The entity to mask or unmask
                    - 'type': The type of the entity

    Returns:
            The text with PII replaced by labels
    """
    # Collect modifier entities for overlap resolution
    modifier_entities = set()
    if modifiers:
        for modifier in modifiers:
            # Handle both dictionary and Pydantic object formats
            entity = (
                modifier.entity
                if hasattr(modifier, "entity")
                else modifier.get("entity")
            )
            if entity:
                modifier_entities.add(entity)

    # Collect all replacements with their positions
    replacements = []
    for pii in pii_list:
        # Handle both dictionary and PiiEntity object formats
        if hasattr(pii, "type"):
            # PiiEntity object
            label = pii.type + "_" + str(pii.id)
            text_value = pii.text
            occurrences = pii.occurrences
        else:
            # Dictionary
            label = pii["type"] + "_" + str(pii["id"])
            text_value = pii.get("text", pii.get("name", ""))
            occurrences = pii["occurrences"]

        for occurrence in occurrences:
            # Handle both dictionary and PiiOccurrence object formats
            if hasattr(occurrence, "start_idx"):
                # PiiOccurrence object
                start_idx = occurrence.start_idx
                end_idx = occurrence.end_idx
            else:
                # Dictionary
                start_idx = occurrence["start_idx"]
                end_idx = occurrence["end_idx"]

            replacements.append(
                {
                    "start_idx": start_idx,
                    "end_idx": end_idx,
                    "replacement": f"[{{{label}}}]",
                    "source_entity": text_value,
                }
            )

    # Resolve overlaps according to the specified rules
    resolved_replacements = _resolve_overlaps(replacements, modifier_entities)

    # Sort replacements by start index in descending order
    # This ensures that when we make replacements, the indices for earlier
    # replacements don't change
    resolved_replacements.sort(key=lambda x: x["start_idx"], reverse=True)

    # Apply all replacements
    for replacement in resolved_replacements:
        log.debug("Replacing: %s, in text: %s", replacement, text)

        start_idx = replacement["start_idx"]
        end_idx = replacement["end_idx"]
        replacement_text = replacement["replacement"]
        text = text[:start_idx] + replacement_text + text[end_idx:]

    return text


def consolidate_pii_data(pii_data: list[dict], file_entities_dict: dict) -> dict:
    """
    Consolidate PII data by using id from known entities.
    """
    # update ids
    for file_pii in pii_data:
            file_pii["id"] = file_entities_dict[file_pii["text"].lower()]["id"]
            file_pii["type"] = file_entities_dict[file_pii["text"].lower()]["type"]
            file_pii["label"] = f"{file_entities_dict[file_pii['text'].lower()]['type']}_{file_entities_dict[file_pii['text'].lower()]['id']}"
    return pii_data


def set_file_entity_ids(file_entities_dict: dict, known_entities: list[dict]) -> dict:
    """
    Set the ids of the file entities based on the known entities.
    """
    known_entities_dict = {known_entity["name"].lower(): known_entity for known_entity in known_entities}

    # update id in file_entities_dict with next free unique id or known entity id
    max_id_known_entities = max([pii["id"] for pii in known_entities]) if known_entities_dict else 0
    for pii in file_entities_dict:
        if pii in known_entities_dict:
            file_entities_dict[pii]["id"] = known_entities_dict[pii]["id"]
            file_entities_dict[pii]["type"] = known_entities_dict[pii]["label"].split("_")[0]
            file_entities_dict[pii]["label"] = f"{file_entities_dict[pii]['type']}_{file_entities_dict[pii]['id']}"
        else:
            max_id_known_entities += 1
            file_entities_dict[pii]["id"] = max_id_known_entities
            file_entities_dict[pii]["label"] = f"{file_entities_dict[pii]['type']}_{file_entities_dict[pii]['id']}"        

    return file_entities_dict
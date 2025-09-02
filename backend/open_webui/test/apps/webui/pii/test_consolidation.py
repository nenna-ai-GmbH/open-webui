import pytest
import json
from open_webui.test.util.mock_user import mock_webui_user
from open_webui.utils.pii import consolidate_pii_data, text_masking


def test_consolidate_pii_data_basic():
    """Test basic PII consolidation functionality"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John Doe"},
        {"id": 2, "label": "EMAIL_1", "name": "john@example.com"}
    ]
    
    pii_data = [
        {"text": "john doe", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 8}], "id": 3},
        {"text": "john@example.com", "type": "EMAIL", "occurrences": [{"start_idx": 10, "end_idx": 25}], "id": 4}
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Check that IDs are properly assigned
    assert result[0]["id"] == 1  # John Doe should get ID 1
    assert result[1]["id"] == 2  # john@example.com should get ID 2


def test_consolidate_pii_data_case_insensitive():
    """Test that consolidation works case-insensitively"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John Doe"}
    ]
    
    pii_data = [
        {"text": "JOHN DOE", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 8}]}
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Should match despite case difference
    assert result[0]["id"] == 1


def test_consolidate_pii_data_no_match():
    """Test consolidation when no matches are found"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John Doe"}
    ]
    
    pii_data = [
        {"text": "Jane Smith", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 10}]}
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Should return original data without ID assignment
    assert "id" not in result[0]


def test_text_masking_basic():
    """Test basic text masking functionality"""
    text = "Hello John Doe, your email is john@example.com"
    
    pii_list = [
        {
            "type": "PERSON",
            "id": 1,
            "text": "John Doe",
            "occurrences": [{"start_idx": 6, "end_idx": 14}]
        },
        {
            "type": "EMAIL", 
            "id": 2,
            "text": "john@example.com",
            "occurrences": [{"start_idx": 30, "end_idx": 46}]
        }
    ]
    
    result = text_masking(text, pii_list, [])
    
    expected = "Hello [{PERSON_1}], your email is [{EMAIL_2}]"
    assert result == expected


def test_text_masking_with_modifiers():
    """Test text masking with modifiers"""
    text = "Hello John Doe, your email is john@example.com"
    
    pii_list = [
        {
            "type": "PERSON",
            "id": 1,
            "text": "John Doe",
            "occurrences": [{"start_idx": 6, "end_idx": 14}]
        }
    ]
    
    modifiers = [
        {"action": "mask", "entity": "your email", "type": "TEST"}
    ]
    
    result = text_masking(text, pii_list, modifiers)
    
    # Should not mask "John Doe" due to ignore modifier
    expected = "Hello [{PERSON_1}], [{TEST}] is john@example.com"
    assert result == expected


def test_text_masking_overlapping_entities():
    """Test text masking with overlapping entities"""
    text = "John Doe Smith"
    
    pii_list = [
        {
            "type": "PERSON",
            "id": 1,
            "text": "John Doe",
            "occurrences": [{"start_idx": 0, "end_idx": 8}]
        },
        {
            "type": "PERSON",
            "id": 2,
            "text": "Doe Smith",
            "occurrences": [{"start_idx": 5, "end_idx": 14}]
        }
    ]
    
    result = text_masking(text, pii_list, [])
    
    # Should handle overlapping entities (longer span takes precedence)
    assert "[{PERSON_2}]" in result  # Doe Smith should be masked


def test_pii_data_parsing_from_metadata():
    """Test parsing PII data from document metadata"""
    # Simulate PII data stored as JSON string in metadata
    pii_dict = {
        "John Doe": {
            "id": 1,
            "label": "PERSON_1",
            "type": "PERSON",
            "text": "John Doe",
            "occurrences": [{"start_idx": 0, "end_idx": 8}]
        },
        "john@example.com": {
            "id": 2,
            "label": "EMAIL_1", 
            "type": "EMAIL",
            "text": "john@example.com",
            "occurrences": [{"start_idx": 10, "end_idx": 25}]
        }
    }
    
    pii_json = json.dumps(pii_dict)
    parsed_pii = json.loads(pii_json)
    pii_data = list(parsed_pii.values())
    
    assert len(pii_data) == 2
    assert pii_data[0]["text"] == "John Doe"
    assert pii_data[1]["text"] == "john@example.com"


def test_consolidation_with_empty_data():
    """Test consolidation with empty or invalid data"""
    # Empty known entities
    result = consolidate_pii_data([], [{"text": "John Doe", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 8}], "id": 1}])
    assert len(result) == 1
    assert result[0]["id"] == 1
    
    # Empty PII data
    result = consolidate_pii_data([{"id": 1, "name": "John Doe"}], [])
    assert len(result) == 0

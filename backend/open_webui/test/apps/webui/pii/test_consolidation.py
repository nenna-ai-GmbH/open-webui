import pytest
import json
from open_webui.test.util.mock_user import mock_webui_user
from open_webui.utils.pii import consolidate_pii_data, text_masking


def test_consolidate_pii_data_basic():
    """Test basic PII consolidation functionality - same text, different ID"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John Doe"},
        {"id": 2, "label": "EMAIL_1", "name": "john@example.com"}
    ]
    
    pii_data = [
        {"text": "john doe", "label": "PERSON_3", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 8}], "id": 3, "raw_text": "John Doe"},
        {"text": "john@example.com", "label": "EMAIL_4", "type": "EMAIL", "occurrences": [{"start_idx": 10, "end_idx": 25}], "id": 4, "raw_text": "john@example.com"}
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Check that IDs are properly assigned
    assert len(result) == 2
    assert result[0]["id"] == 1  # John Doe should get ID 1
    assert result[1]["id"] == 2  # john@example.com should get ID 2


def test_consolidate_pii_data_no_match():
    """Test consolidation when no matches are found"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John Doe"}
    ]
    
    pii_data = [
        {"text": "jane smith", "label": "PERSON_3", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 10}], "id": 3, "raw_text": "Jane Smith"}
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Should return original data without ID assignment
    assert len(result) == 1
    assert result[0]["id"] == 3


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
    expected = "Hello [{PERSON_1}], [{TEST_2}] is john@example.com"
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
    assert "John [{PERSON_2}]" in result  # Doe Smith should be masked


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


def test_consolidate_ids():
    """Test consolidation of IDs - not matching text"""
    known_entities = [
        {"id": 1, "label": "PERSON_1", "name": "John McDowell"},
        {"id": 2, "label": "EMAIL_1", "name": "mcdowell@example.com"}
    ]
    
    pii_data = [
        {"id": 1, "label": "PERSON_1", "text": "john doe", "type": "PERSON", "occurrences": [{"start_idx": 0, "end_idx": 8}], "raw_text": "John Doe"},  
        {"id": 2, "label": "EMAIL_2", "text": "john@example.com", "type": "EMAIL", "occurrences": [{"start_idx": 10, "end_idx": 25}], "raw_text": "john@example.com"} 
    ]
    
    result = consolidate_pii_data(known_entities, pii_data)
    
    # Check that IDs are properly assigned
    assert len(result) == 2
    ids = [item["id"] for item in result]
    assert len(ids) == 2
    assert set(ids) == {3, 4}
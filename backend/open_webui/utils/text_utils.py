"""
Text processing utilities for Open WebUI

Handles text formatting with page markers (when available) or chunk markers (when needed).
"""

import logging

log = logging.getLogger(__name__)


def format_text_with_breaks(docs, chunk_size: int = 1000, chunk_threshold: int = 1200) -> str:
    """
    Format text with appropriate break markers based on available metadata.
    
    Priority:
    1. Use PAGE markers if documents have page information
    2. Use CHUNK markers if text is large and no page info
    3. Return as-is for short texts without page info
    
    Args:
        docs: List of document objects with page_content and metadata
        chunk_size (int): Size for chunks when chunking is needed (default: 1000)
        chunk_threshold (int): Length threshold to trigger chunking (default: 1200)
        
    Returns:
        str: Formatted text with appropriate break markers
    """
    # Check if any documents have page information
    has_page_info = any(
        doc.metadata.get("page") is not None 
        for doc in docs 
        if hasattr(doc, 'metadata') and doc.metadata
    )
    
    if has_page_info:
        # Use page markers for documents with page information (PDFs, etc.)
        page_contents = []
        for doc in docs:
            page_num = doc.metadata.get("page", doc.metadata.get("page_label", ""))
            if page_num is not None and page_num != "":
                page_contents.append(
                    f"--- PAGE {page_num + 1 if isinstance(page_num, int) else page_num} ---\n{doc.page_content}"
                )
            else:
                page_contents.append(doc.page_content)
        return "\n\n".join(page_contents)
    
    else:
        # No page information available
        concatenated_text = " ".join([doc.page_content for doc in docs])
        
        # Only chunk if text is large enough to warrant it
        if len(concatenated_text) > chunk_threshold:
            return _chunk_text_content(concatenated_text, chunk_size=chunk_size)
        else:
            # Keep short texts as-is without any markers
            return concatenated_text


def _chunk_text_content(text: str, chunk_size: int = 1000, overlap: int = 100) -> str:
    """
    Internal function to chunk text into segments with CHUNK markers.
    
    Args:
        text (str): The text content to chunk
        chunk_size (int): Maximum characters per chunk
        overlap (int): Character overlap between chunks for context
    
    Returns:
        str: Text with CHUNK markers inserted between segments
    """
    if not text or len(text) <= chunk_size:
        return text
    
    chunks = []
    chunk_num = 1
    start = 0
    
    while start < len(text):
        # Calculate end position for this chunk
        end = start + chunk_size
        
        # If not the last chunk, try to break at word boundary
        if end < len(text):
            # Look for the last space within the chunk to avoid breaking words
            last_space = text.rfind(' ', start, end)
            if last_space > start:
                end = last_space
        
        # Extract chunk content
        chunk_content = text[start:end].strip()
        
        if chunk_content:
            chunks.append(f"--- CHUNK {chunk_num} ---\n{chunk_content}")
            chunk_num += 1
        
        # Move start position (with overlap for context continuity)
        start = max(end - overlap, start + 1)
        
        # Safety check to prevent infinite loops
        if start >= len(text):
            break
    
    return "\n\n".join(chunks) 
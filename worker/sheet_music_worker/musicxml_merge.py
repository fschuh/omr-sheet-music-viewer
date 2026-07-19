from __future__ import annotations

import os
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from typing import Sequence


class MusicXmlMergeError(ValueError):
    """Raised when page-level MusicXML files cannot form one score."""


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children_named(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in element if _local_name(child.tag) == name]


def _parts(root: ElementTree.Element) -> list[ElementTree.Element]:
    return _children_named(root, "part")


def _measures(part: ElementTree.Element) -> list[ElementTree.Element]:
    return _children_named(part, "measure")


def _staff_count(part: ElementTree.Element) -> int:
    for element in part.iter():
        if _local_name(element.tag) != "staves":
            continue
        try:
            return int(element.text or "")
        except ValueError as error:
            raise MusicXmlMergeError("A part has a non-numeric <staves> value") from error
    return 1


def _part_signature(root: ElementTree.Element, source: Path) -> list[tuple[str, int]]:
    parts = _parts(root)
    if not parts:
        raise MusicXmlMergeError(f"{source.name} does not contain any score parts")

    signature: list[tuple[str, int]] = []
    for part in parts:
        part_id = part.get("id")
        if not part_id:
            raise MusicXmlMergeError(f"{source.name} contains a part without an id")
        if not _measures(part):
            raise MusicXmlMergeError(f"{source.name} part {part_id} does not contain any measures")
        signature.append((part_id, _staff_count(part)))
    return signature


def _scope_measure_ids(measure: ElementTree.Element, page_number: int) -> None:
    for element in measure.iter():
        element_id = element.get("id")
        if element_id:
            element.set("id", f"page-{page_number}-{element_id}")


def _add_page_break(measure: ElementTree.Element, page_number: int) -> None:
    prints = _children_named(measure, "print")
    if prints:
        page_break = prints[0]
    else:
        namespace = measure.tag[: measure.tag.index("}") + 1] if "}" in measure.tag else ""
        page_break = ElementTree.Element(f"{namespace}print")
        measure.insert(0, page_break)
    page_break.set("new-page", "yes")
    page_break.set("page-number", str(page_number))


def _parse_score(source: Path) -> ElementTree.ElementTree:
    try:
        tree = ElementTree.parse(source)
    except (OSError, ElementTree.ParseError) as error:
        raise MusicXmlMergeError(f"Could not parse {source.name}: {error}") from error
    if _local_name(tree.getroot().tag) != "score-partwise":
        raise MusicXmlMergeError(f"{source.name} is not a partwise MusicXML score")
    return tree


def merge_musicxml_pages(page_paths: Sequence[Path], output_path: Path) -> None:
    """Merge page-level HOMR scores in order and atomically write one MusicXML file."""
    if not page_paths:
        raise MusicXmlMergeError("At least one page-level MusicXML file is required")

    main_tree = _parse_score(page_paths[0])
    main_root = main_tree.getroot()
    expected_signature = _part_signature(main_root, page_paths[0])
    main_parts = _parts(main_root)
    next_measure_numbers = [1 for _part in main_parts]

    for page_index, source in enumerate(page_paths):
        page_number = page_index + 1
        if page_index == 0:
            page_root = main_root
            page_parts = main_parts
        else:
            page_tree = _parse_score(source)
            page_root = page_tree.getroot()
            signature = _part_signature(page_root, source)
            if signature != expected_signature:
                raise MusicXmlMergeError(
                    f"{source.name} has parts/staves {signature}, expected {expected_signature}"
                )
            page_parts = _parts(page_root)

        for part_index, page_part in enumerate(page_parts):
            measures = _measures(page_part)
            for measure_index, measure in enumerate(measures):
                _scope_measure_ids(measure, page_number)
                measure.set("number", str(next_measure_numbers[part_index]))
                next_measure_numbers[part_index] += 1
                if page_index > 0 and measure_index == 0:
                    _add_page_break(measure, page_number)
                if page_index > 0:
                    main_parts[part_index].append(measure)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        ElementTree.indent(main_tree, space="  ")
        main_tree.write(temporary, encoding="utf-8", xml_declaration=True)
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()

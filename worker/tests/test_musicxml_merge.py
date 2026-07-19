import xml.etree.ElementTree as ElementTree
from pathlib import Path

import pytest

from sheet_music_worker.musicxml_merge import MusicXmlMergeError, merge_musicxml_pages


def write_score(
    path: Path,
    *,
    measure_numbers: list[str],
    part_ids: tuple[str, ...] = ("P1",),
    staves: int = 1,
) -> None:
    root = ElementTree.Element("score-partwise", {"version": "4.0"})
    part_list = ElementTree.SubElement(root, "part-list")
    for part_id in part_ids:
        score_part = ElementTree.SubElement(part_list, "score-part", {"id": part_id})
        ElementTree.SubElement(score_part, "part-name").text = "Piano" if staves == 2 else "Voice"

    for part_id in part_ids:
        part = ElementTree.SubElement(root, "part", {"id": part_id})
        for note_index, measure_number in enumerate(measure_numbers, start=1):
            measure = ElementTree.SubElement(part, "measure", {"number": measure_number})
            attributes = ElementTree.SubElement(measure, "attributes")
            ElementTree.SubElement(attributes, "divisions").text = "4"
            if staves == 2:
                ElementTree.SubElement(attributes, "staves").text = "2"
            note = ElementTree.SubElement(
                measure,
                "note",
                {"id": f"homr-note-{note_index}"},
            )
            ElementTree.SubElement(note, "rest")
            ElementTree.SubElement(note, "duration").text = "16"
            ElementTree.SubElement(note, "type").text = "whole"

    ElementTree.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def test_merge_appends_pages_renumbers_measures_and_scopes_ids(tmp_path: Path) -> None:
    first = tmp_path / "0001.musicxml"
    second = tmp_path / "0002.musicxml"
    output = tmp_path / "Score.musicxml"
    write_score(first, measure_numbers=["7", "A"])
    write_score(second, measure_numbers=["1"])

    merge_musicxml_pages([first, second], output)

    root = ElementTree.parse(output).getroot()
    measures = root.findall("./part/measure")
    assert [measure.get("number") for measure in measures] == ["1", "2", "3"]
    assert [note.get("id") for note in root.findall("./part/measure/note")] == [
        "page-1-homr-note-1",
        "page-1-homr-note-2",
        "page-2-homr-note-1",
    ]
    assert measures[2].find("print").attrib == {
        "new-page": "yes",
        "page-number": "2",
    }
    assert measures[2].findtext("attributes/divisions") == "4"
    assert ElementTree.parse(second).find("./part/measure/note").get("id") == "homr-note-1"


def test_merge_preserves_part_order_across_pages(tmp_path: Path) -> None:
    first = tmp_path / "0001.musicxml"
    second = tmp_path / "0002.musicxml"
    output = tmp_path / "Score.musicxml"
    write_score(first, measure_numbers=["1"], part_ids=("P1", "P2"), staves=2)
    write_score(second, measure_numbers=["1", "2"], part_ids=("P1", "P2"), staves=2)

    merge_musicxml_pages([first, second], output)

    parts = ElementTree.parse(output).getroot().findall("./part")
    assert [part.get("id") for part in parts] == ["P1", "P2"]
    assert [[measure.get("number") for measure in part] for part in parts] == [
        ["1", "2", "3"],
        ["1", "2", "3"],
    ]
    assert all(part.findall("measure")[1].find("print").get("new-page") == "yes" for part in parts)


@pytest.mark.parametrize(
    ("second_parts", "second_staves"),
    [
        (("P1", "P2"), 1),
        (("P1",), 2),
    ],
)
def test_merge_rejects_part_or_staff_mismatches(
    tmp_path: Path,
    second_parts: tuple[str, ...],
    second_staves: int,
) -> None:
    first = tmp_path / "0001.musicxml"
    second = tmp_path / "0002.musicxml"
    output = tmp_path / "Score.musicxml"
    write_score(first, measure_numbers=["1"])
    write_score(
        second,
        measure_numbers=["1"],
        part_ids=second_parts,
        staves=second_staves,
    )

    with pytest.raises(MusicXmlMergeError, match="parts/staves"):
        merge_musicxml_pages([first, second], output)

    assert not output.exists()


def test_merge_requires_at_least_one_page(tmp_path: Path) -> None:
    with pytest.raises(MusicXmlMergeError, match="At least one"):
        merge_musicxml_pages([], tmp_path / "Score.musicxml")

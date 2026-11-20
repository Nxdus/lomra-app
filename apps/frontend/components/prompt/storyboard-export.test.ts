import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "three/addons/libs/fflate.module.js";
import { prepareStoryboardExport, storyboardZip } from "./storyboard-export-data";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Z+HkAAAAASUVORK5CYII=";
const picture = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
const images = [{ name: "Harbor [wide]", url: `data:image/png;base64,${png}` }];

test("exports shots in storyboard order with stable and fallback paths and approved cast assets", async () => {
  const result = await prepareStoryboardExport({
    story: "The boat arrives.",
    shots: [
      { id: "z-stable", scene: "Harbor", description: "A boat approaches.", seconds: 3, image: null, generatedId: "saved-picture",
        references: [0], characters: [0], camera: "Wide", dialogue: "Hello!", sound: "Waves" },
      { description: "A sailor ties the rope.", seconds: 2, image: 0, references: [] },
      { id: "a-stable", description: "The boat settles.", seconds: 4, image: 0, references: [] },
    ],
    characters: [
      { name: "Sailor", notes: "Blue jacket", image: 0, approved: true },
      { name: "Unused", notes: "Draft cast notes", image: 0 },
    ],
  }, images, undefined, async (id) => {
    assert.equal(id, "saved-picture");
    return new Blob([picture], { type: "application/octet-stream" });
  });
  const archive = unzipSync(storyboardZip(result.markdown + "\nEdited ending.\n", result.files));
  assert.deepEqual(Object.keys(archive), [
    "storyboard.md",
    "shots/id-z-stable/picture.png",
    "shots/id-z-stable/reference-1.png",
    "shots/shot-2/picture.png",
    "shots/id-a-stable/picture.png",
    "cast/character-1.png",
  ]);
  for (const name of Object.keys(result.files)) assert.deepEqual(archive[name], picture);
  const markdown = strFromU8(archive["storyboard.md"]);
  assert.match(markdown, /Shot 1\n[\s\S]*Duration: 3 s[\s\S]*Scene: Harbor[\s\S]*Shot 2\n[\s\S]*Duration: 2 s[\s\S]*Shot 3\n/);
  for (const text of ["The boat arrives.", "Camera: Wide", "Dialogue: Hello!", "Sound: Waves", "Cast: Sailor",
    "Blue jacket", "Edited ending.", "(shots/id-z-stable/reference-1.png)", "(cast/character-1.png)"]) {
    assert.ok(markdown.includes(text));
  }
  assert.doesNotMatch(markdown, /Draft cast notes/);
  assert.deepEqual(result.missing, []);
});

test("keeps a downloadable draft when indexed, generated, or unset assets are missing", async () => {
  const result = await prepareStoryboardExport({
    story: "A draft.",
    shots: [
      { description: "First", seconds: 3, image: null, generatedId: "missing-file", references: [2] },
      { description: "Second", seconds: 2, image: null, references: [0] },
    ],
    characters: [{ name: "Sailor", notes: "Blue jacket", image: null, approved: true }],
  }, images, undefined, async () => { throw new Error("File not found"); });
  assert.deepEqual(result.missing, ["Shot 1 picture", "Shot 1 reference: Reference 3", "Shot 2 picture", "Sailor reference"]);
  assert.match(result.markdown, /## Missing assets/);
  assert.match(result.markdown, /- Picture: Missing/);
  const archive = unzipSync(storyboardZip(result.markdown, result.files));
  assert.deepEqual(Object.keys(archive), ["storyboard.md", "shots/shot-2/reference-1.png"]);
  assert.equal(strFromU8(archive["storyboard.md"]), result.markdown);
});

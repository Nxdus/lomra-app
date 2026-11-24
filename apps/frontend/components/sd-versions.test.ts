// @ts-expect-error bun:test is provided by the Bun test runner.
import { expect, test } from "bun:test";
import { defaultSdFile, sdVersions } from "./sd-versions";

const file = (name: string, gigabytes: number) => ({ id: name, file: name, bytes: gigabytes * 1e9 });

test("files of one model share a title and are told apart by what differs", () => {
  const { title, label } = sdVersions("a/b", [file("model-v1-Q4_0.gguf", 1.6), file("model-v1-Q8_0.gguf", 1.8), file("model-v1-f16.gguf", 2.1)]);
  expect(title).toBe("model-v1");
  expect(["model-v1-Q4_0.gguf", "model-v1-Q8_0.gguf"].map(label)).toEqual(["Q4_0", "Q8_0"]);
});

test("unrelated files and a single file keep their names", () => {
  const mixed = sdVersions("owner/collection", [file("dream_8.safetensors", 2), file("vivid.safetensors", 2)]);
  expect(mixed.title).toBe("collection");
  expect(mixed.label("vivid.safetensors")).toBe("vivid");
  const single = sdVersions("a/b", [file("sd-v1-5-inpainting.safetensors", 4)]);
  expect(single.title).toBe("sd-v1-5-inpainting");
  // One name is the beginning of another.
  const nested = sdVersions("a/b", [file("model-xl.safetensors", 6), file("model-xl-fp16.safetensors", 3)]);
  expect(nested.label("model-xl.safetensors")).toBe("xl");
  expect(sdVersions("a/b", []).title).toBe("b");
});

test("the first choice is 8-bit, then half precision, then the smallest, within the graphics memory", () => {
  const files = [file("m-f32.gguf", 8), file("m-fp16.safetensors", 4), file("m-Q8_0.gguf", 3), file("m-Q2_K.gguf", 1)];
  expect(defaultSdFile(files, 0).file).toBe("m-Q8_0.gguf");
  expect(defaultSdFile(files.filter((item) => !/Q8/.test(item.file)), 0).file).toBe("m-fp16.safetensors");
  expect(defaultSdFile(files, 2e9).file).toBe("m-Q2_K.gguf");
  // Nothing fits: still offer one.
  expect(defaultSdFile([files[0], files[1]], 1e9).file).toBe("m-fp16.safetensors");
  expect(defaultSdFile([], 0)).toBeUndefined();
});

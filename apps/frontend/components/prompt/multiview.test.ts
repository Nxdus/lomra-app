import assert from "node:assert/strict";
import test from "node:test";
import { generate, type Generation } from "./generation";
import { isMultiview, modelViews, multiviewError, multiviewInput, multiviewRequirements, type ModelViews } from "./multiview";

const views: ModelViews = Object.fromEntries(modelViews.map((view, i) => [view, { url: `data:image/png;base64,${["YQ==", "Yg==", "Yw==", "ZA=="][i]}`, name: view }]));

test("all supported multiview endpoints submit their own input schema and load the result", async () => {
  const cases: [string, ModelViews, object][] = [
    ...["meshy/v7.1/multi-image-to-3d", "meshy/v7/multi-image-to-3d", "fal-ai/trellis/multi"].map((model): [string, ModelViews, object] => [model, views, { image_urls: modelViews.map((view) => views[view]!.url) }]),
    ...["hitem3d/hi3d/v3.0/multi-view-to-3d", "hitem3d/hi3d/multi-view-to-3d", "tripo3d/tripo/v2.5/multiview-to-3d"].map((model): [string, ModelViews, object] => [model, views, Object.fromEntries(modelViews.map((view) => [`${view}_image_url`, views[view]!.url]))]),
    ...["fal-ai/hunyuan3d/v2/multi-view", "fal-ai/hunyuan3d/v2/multi-view/turbo"].map((model): [string, ModelViews, object] => [model, { front: views.front, back: views.back, left: views.left }, { front_image_url: views.front!.url, back_image_url: views.back!.url, left_image_url: views.left!.url }]),
    ["tripo3d/h3.1/multiview-to-3d", views, { image_urls: [views.front!.url, views.left!.url, views.back!.url, views.right!.url] }],
  ];
  for (const [model, inputViews, expected] of cases) {
    assert.ok(isMultiview(model));
    const task: Generation = { id: model, model, category: "3d", prompt: "test", status: "Waiting", views: inputViews };
    const actions: string[] = [];
    const files = await generate(task, async (_, options) => {
      actions.push(options.action);
      if (options.action === "submit") {
        assert.deepEqual(options.input, expected, model);
        return { request_id: "job" };
      }
      return options.action === "status" ? { status: "COMPLETED" } : { model_glb: { url: "https://fal.media/model.glb" } };
    }, new AbortController().signal, () => {});
    assert.deepEqual(actions, ["submit", "status", "result"]);
    assert.equal(files[0].name, "GLB");
  }
});

test("validation follows each model's view count, formats and positional order", () => {
  const meshy = "meshy/v7.1/multi-image-to-3d";
  assert.deepEqual(multiviewInput(meshy, { back: views.back }), { image_urls: [views.back!.url] });
  assert.match(multiviewRequirements(meshy), /1–4 images/);
  assert.match(multiviewError(meshy, {})!, /at least 1/);
  assert.match(multiviewError(meshy, { front: views.front, left: views.front })!, /different image/);
  assert.match(multiviewError(meshy, { front: { url: "data:image/webp;base64,YQ==", name: "front" } })!, /PNG or JPEG/);
  assert.match(multiviewError(meshy, { front: { url: "data:image/png;base64,YQ=", name: "front" } })!, /Use PNG/);
  assert.match(multiviewError(meshy, { ...views, top: views.front } as ModelViews)!, /accepts/);
  assert.match(multiviewError("fal-ai/hunyuan3d/v2/multi-view/turbo", views)!, /accepts/);
  assert.match(multiviewError("tripo3d/h3.1/multiview-to-3d", { front: views.front, back: views.back })!, /left/);
  assert.deepEqual(multiviewInput("tripo3d/h3.1/multiview-to-3d", { front: views.front, left: views.left }), { image_urls: [views.front!.url, views.left!.url] });
  assert.match(multiviewError("other/multi-image-to-3d", views)!, /not supported/);
  assert.match(multiviewError("fal-ai/meshy/v6/multi-image-to-3d", views)!, /not supported/);
});

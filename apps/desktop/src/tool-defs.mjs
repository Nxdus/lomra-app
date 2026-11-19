/** Tools the app offers to a local agent. Execution happens in the renderer, which holds the canvas and API keys. */
export const toolDefs = [
  {
    name: 'generate_image',
    description: 'Generate an image with the image model selected in the Lomra prompt and add it to the canvas. If exactly one image is selected on the canvas it is used as the reference. Takes up to a few minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image should show.' },
        aspect_ratio: { type: 'string', description: 'Optional, for example 1:1, 16:9 or 9:16.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_3d',
    description: 'Generate a 3D model with the selected Lomra model. Image-to-3D needs exactly one image. For Multi-view, call canvas_selection with include_images, then map the required views to image indices. Ask the user when views are missing or ambiguous. Takes several minutes.',
    inputSchema: { type: 'object', properties: {
      prompt: { type: 'string', description: 'What the model should look like.' },
      viewIndices: {
        type: 'object', additionalProperties: false,
        description: 'Multi-view only. Map each view to the zero-based image index from canvas_selection. Use each image at most once.',
        properties: Object.fromEntries(['front', 'back', 'left', 'right'].map((view) => [view, { type: 'integer', minimum: 0, maximum: 9 }])),
      },
    }, required: ['prompt'] },
  },
  {
    name: 'generate_video',
    description: 'Generate a video with the video model selected in the Lomra prompt and add it to the canvas. Takes several minutes.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'What the video should show.' } }, required: ['prompt'] },
  },
  {
    name: 'canvas_selection',
    description: 'List the selected canvas items and chosen generation models. Set include_images to true to view the selected images.',
    inputSchema: { type: 'object', properties: { include_images: { type: 'boolean', description: 'Return previews of the selected images.' } } },
  },
];

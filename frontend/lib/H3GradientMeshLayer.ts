import { Layer, project32 } from "@deck.gl/core";
import type { LayerContext, LayerProps, UpdateParameters, DefaultProps } from "@deck.gl/core";
import { Model } from "@luma.gl/engine";
import { Buffer, RenderPass } from "@luma.gl/core";

// Vertex shader: takes [lng, lat] positions and projects to clip space via
// deck.gl's project32 module. Per-vertex RGBA (unorm8x4) interpolation is
// handled automatically by WebGL's rasterizer — no fragment-shader work needed.
const vs = `\
#version 300 es
#define SHADER_NAME h3-gradient-mesh-vs

in vec2 positions;
in vec4 colors;

out vec4 vColor;

void main() {
  vec3 p = vec3(positions, 0.0);
  gl_Position = project_position_to_clipspace(p, vec3(0.0), vec3(0.0));
  vColor = colors;
}
`;

// Fragment shader: pass the interpolated per-vertex color through, then let
// deck.gl's DECKGL_FILTER_COLOR macro apply any registered color effects.
const fs = `\
#version 300 es
#define SHADER_NAME h3-gradient-mesh-fs
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

export type H3GradientMeshLayerProps = {
  positions: Float32Array;
  colors: Uint8Array;
  vertexCount: number;
} & LayerProps;

const defaultProps: DefaultProps<H3GradientMeshLayerProps> = {
  positions: { type: "object", value: new Float32Array() },
  colors: { type: "object", value: new Uint8Array() },
  vertexCount: { type: "number", value: 0 },
};

type LayerState = {
  model: Model;
  positionsBuffer: Buffer | null;
  colorsBuffer: Buffer | null;
};

export class H3GradientMeshLayer extends Layer<H3GradientMeshLayerProps> {
  static layerName = "H3GradientMeshLayer";
  static defaultProps = defaultProps;

  declare state: LayerState;

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32] });
  }

  initializeState(): void {
    const { device } = this.context;
    const shaders = this.getShaders();
    const model = new Model(device, {
      ...shaders,
      id: this.props.id,
      bufferLayout: [
        { name: "positions", format: "float32x2" },
        { name: "colors", format: "unorm8x4" },
      ],
      topology: "triangle-list",
      vertexCount: 0,
    });
    this.setState({ model, positionsBuffer: null, colorsBuffer: null });
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    if (
      changeFlags.propsOrDataChanged ||
      props.positions !== oldProps.positions ||
      props.colors !== oldProps.colors ||
      props.vertexCount !== oldProps.vertexCount
    ) {
      this._updateBuffers();
    }
  }

  draw(opts: { renderPass: RenderPass } & Record<string, unknown>): void {
    const { model } = this.state;
    if (!model || this.props.vertexCount === 0) return;
    model.draw(opts.renderPass);
  }

  finalizeState(context: LayerContext): void {
    super.finalizeState(context);
    this.state.positionsBuffer?.destroy();
    this.state.colorsBuffer?.destroy();
  }

  private _updateBuffers(): void {
    const { device } = this.context;
    const { positions, colors, vertexCount } = this.props;
    const state = this.state;

    state.positionsBuffer?.destroy();
    state.colorsBuffer?.destroy();

    const positionsBuffer = device.createBuffer({
      data: positions,
      usage: Buffer.VERTEX,
    });
    const colorsBuffer = device.createBuffer({
      data: colors,
      usage: Buffer.VERTEX,
    });

    state.model.setAttributes({
      positions: positionsBuffer,
      colors: colorsBuffer,
    });
    state.model.setVertexCount(vertexCount);

    this.setState({ positionsBuffer, colorsBuffer });
  }
}

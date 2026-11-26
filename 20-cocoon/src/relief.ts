import type { Head } from "./load";
import code from "./relief.wgsl?raw";

/** The cocoons' relief, made here: what the networks are told of it (a texture) and the shells' mesh (a byte a point). */
export const makeRelief = (device: GPUDevice, head: Head, like?: { style: number; wave: number; high: number; ring: number }, finer?: (code: string) => string) => {
  // (finer: twice the grid, and what that has place for)
  const [NU, NV] = finer ? [3072, 1536] : [1536, 768];
  const { u, v, layers } = head.detail;
  const { u: MU, v: MV, lo, hi } = head.relief;
  const { UNIFORM, STORAGE, COPY_DST, COPY_SRC } = GPUBufferUsage;
  const LEVELS = 5;
  const texture = device.createTexture({
    size: [u, v, layers],
    format: "rgba8unorm",
    mipLevelCount: LEVELS,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const level = (baseMipLevel: number) => texture.createView({ dimension: "2d-array", baseMipLevel, mipLevelCount: 1 });
  const relief = device.createBuffer({ size: MU * (MV + 1) * layers, usage: STORAGE | COPY_SRC });
  const field = device.createBuffer({ size: NU * NV * 16, usage: STORAGE });
  const module = device.createShaderModule({ code: finer ? finer(code) : code });
  const pipe = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
  const group = (p: GPUComputePipeline, entries: [number, GPUBindingResource][]) =>
    device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map(([binding, resource]) => ({ binding, resource })) });
  const [crinkle, blurRound, blurAlong, detail, mesh, half] = ["crinkle", "blurRound", "blurAlong", "detail", "mesh", "half_"].map(pipe);
  const encoder = device.createCommandEncoder();
  const run = (p: GPUComputePipeline, entries: [number, GPUBindingResource][], x: number, y = 1) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, group(p, entries));
    pass.dispatchWorkgroups(x, y);
    pass.end();
  };
  head.made!.forEach((m, n) => {
    const made = device.createBuffer({ size: 48, usage: UNIFORM | COPY_DST });
    const d = new Float32Array(12);
    const { A, B, p } = head.cocoons[n];
    const { wave, high, ring } = like ?? m;
    d.set([wave, high, ring, 0, A, B, p, 0, lo, hi]);
    const ids = new Uint32Array(d.buffer);
    ids[3] = m.seed;
    ids[7] = n;
    ids[10] = like?.style ?? m.style ?? 0;
    device.queue.writeBuffer(made, 0, d);
    const [M, F]: [number, GPUBindingResource][] = [
      [0, { buffer: made }],
      [1, { buffer: field }],
    ];
    run(crinkle, [M, F], NU / 8, NV / 8);
    run(blurRound, [F], NU / 8, NV / 8);
    run(blurAlong, [F], NU / 8, NV / 8);
    run(detail, [M, F, [2, level(0)]], u / 8, v / 8);
    run(mesh, [M, F, [3, { buffer: relief }]], Math.ceil((MU * (MV + 1)) / 4 / 64));
  });
  for (let l = 1; l < LEVELS; l++) run(half, [[2, level(l)], [4, level(l - 1)]], (u >> l) / 8, (v >> l) / 8);
  device.queue.submit([encoder.finish()]);
  device.queue.onSubmittedWorkDone().then(() => field.destroy());
  return { texture, view: texture.createView({ dimension: "2d-array" }), relief };
};

// The stones, the ball, and the dark behind them.

struct Side {
  index: u32,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> side: Side;

struct Solid {
  @builtin(position) clip: vec4f,
  @location(0) local: vec3f,
  @location(1) shape: vec4f,
  @location(2) tone: vec4f,
  @location(3) @interpolate(flat) stone: u32,
};

@vertex
fn solidVs(@location(0) p: vec3f, @location(1) shape: vec4f, @location(2) stone: f32, @location(3) tone: vec4f) -> Solid {
  let id = u32(stone + 0.5);
  var o: Solid;
  o.clip = frame.viewProj * vec4f(scene.stones[side.index * 9u + id].xyz + p, 1.0);
  o.local = p;
  o.shape = shape;
  o.tone = tone;
  o.stone = id;
  return o;
}

@fragment
fn solidFs(i: Solid) -> Picture {
  let life = scene.lives[i.stone];
  let p = i.local;
  let sun = frame.sun.xyz;
  let view = normalize(frame.eye.xyz);
  let n = normalize(i.shape.xyz);
  let first = i.shape.w;
  let last = i.tone.w;

  // the one thing finer than the mesh
  var albedo = i.tone.rgb * (0.8 + 0.4 * noise((p + life.z) * 70.0));

  // where moss is or has just been the stone is dark with wet, and it dries slower than the moss dies
  let moss = alive(life.y, first, last);
  let stain = alive(life.y, min(first, 90.0), min(last + 1.4, 8.95));
  albedo = mix(albedo, albedo * vec3f(0.42, 0.52, 0.3), stain * 0.8);
  albedo = mix(albedo, albedo * vec3f(0.12, 0.14, 0.08), smoothstep(0.1, 0.7, moss));

  let real = onPath(life.x) + p;
  let lit = sunOn(real, life.x, sun, scene.ball);
  let nl = max(dot(n, sun), 0.0);
  // the ball's contact: a dark spot on the stone beneath it, whatever the sun is doing
  let under = length(real - scene.ball.xyz) - scene.ball.w;
  let touch = 0.45 + 0.55 * smoothstep(0.0, 1.1, under);
  var color = albedo * sky(n, frame) * 1.3 * touch + albedo * frame.sunColor.rgb * nl * lit;
  let hv = normalize(sun + view);
  color += frame.sunColor.rgb * pow(max(dot(n, hv), 0.0), 30.0) * 0.05 * lit * (1.0 - moss);
  return Picture(vec4f(color, dot(view, -p) + 0.0001), f32(i.stone + 1u));
}

struct Round {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
  @location(1) real: vec3f,
};

@vertex
fn ballVs(@location(0) a: vec4f) -> Round {
  let r = scene.shape.w;
  let squash = vec3f(scene.shape.y, scene.shape.x, scene.shape.y);
  var o: Round;
  o.clip = frame.viewProj * vec4f(scene.balls[side.index].xyz + a.xyz * squash * r, 1.0);
  o.normal = normalize(a.xyz / squash);
  o.real = scene.ball.xyz + a.xyz * squash * r;
  return o;
}

@fragment
fn ballFs(i: Round) -> Picture {
  let n = normalize(i.normal);
  let view = normalize(frame.eye.xyz);
  let sun = frame.sun.xyz;
  // under the strands it is only the dark they grow out of, and they shade it like anything else
  if (scene.shape.z > 0.5) {
    let core = vec3f(0.012, 0.016, 0.007) * (0.5 + max(dot(n, sun), 0.0));
    return Picture(vec4f(core, dot(view, scene.ball.xyz - i.real) + 0.0001), BALL_LAYER);
  }
  let albedo = vec3f(0.34, 0.052, 0.014);
  let nl = max(dot(n, sun), 0.0);
  let mirror = reflect(-view, n);
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  // what it stands over: moss below, the dark above
  let bounce = mix(vec3f(0.05, 0.075, 0.025), sky(n, frame), smoothstep(-0.7, 0.4, n.y));
  var color = albedo * (bounce * 1.5 + frame.sunColor.rgb * nl);
  color += mix(vec3f(0.03, 0.05, 0.02), sky(mirror, frame) * 1.3, smoothstep(-0.3, 0.5, mirror.y)) * fresnel;
  color += frame.sunColor.rgb * pow(max(dot(mirror, sun), 0.0), 300.0) * 2.5;
  // exactly zero is how the backdrop says it has nothing for the leaf-sized shading to do: that pass
  // would read the curve as bumps, and mistake the stone behind the ball for something shading it
  return Picture(vec4f(color, 0.0), 0.0);
}

struct Screen {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn skyVs(@builtin(vertex_index) i: u32) -> Screen {
  let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: Screen;
  o.clip = vec4f(c, 1.0, 1.0);
  o.uv = c;
  return o;
}

@fragment
fn skyFs(i: Screen) -> Picture {
  let aspect = frame.size.x * frame.size.w;
  let at = vec2f(i.uv.x * aspect, i.uv.y);
  // behind the figure's weight, which is what it has to look centred on
  let glow = exp(-dot(at - vec2f(0.0, 0.1), at - vec2f(0.0, 0.1)) * 1.2);
  let clouds = fbm(vec3f(at * 1.6, 3.0), 4);
  let color = mix(vec3f(0.006, 0.009, 0.005), vec3f(0.03, 0.05, 0.022), glow) * (0.75 + 0.5 * clouds);
  return Picture(vec4f(color, 0.0), 0.0);
}

/**
 * lens.wgsl with the small blurs made at full size (hero.html, macro.html). The gather works from a half-size copy, and
 * that copy is already as soft as a pixel or two of blur: where silk left the sharp zone it went soft all at once, and on
 * a cocoon the edge of the zone (where a plane cuts it) showed as a ring. Now `lay` gathers blurs of up to about three
 * pixels itself, from the full-size picture, and the half-size gather takes over only past that.
 *
 * And a sharp hair over blurred silk shares its pixel's blur (that of the silk in it): its own colour is dropped only as
 * far as something blurred covers the pixel, or nothing would stand in for it and it would be drawn black.
 */
const LAY = `@group(0) @binding(4) var spread: texture_2d<f32>;
// half-size pixels of blur: into the gather from here on
fn wider(b: f32) -> f32 { return smoothstep(1.0, 1.6, b); }
const NEAR = 28;
const REACH = 3.6;                          // full-size pixels: all the blur left to \`lay\`
@fragment
fn lay(o: Out) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sharp));
  let c = textureSampleLevel(sharp, smp, o.uv, 0.0).rgb;
  let own = textureSampleLevel(soft, smp, o.uv, 0.0).xyz;
  let ob = abs(blurOf(own));
  // what the gather spread, a wide tent: half-size pixels don't show
  let t = 1.0 / vec2f(textureDimensions(spread));
  var s = vec4f(0.0);
  for (var i = 0; i < 4; i++) { s += 0.25 * textureSampleLevel(spread, smp, o.uv + (vec2f(f32(i & 1), f32(i >> 1)) - 0.5) * t, 0.0); }
  // and the small blurs, as the gather does them: every pixel near spread over its own disc. Not where all about is sharp
  // (eight looks round it), which is most of the picture
  var most = ob;
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.785398 + 0.39;
    most = max(most, abs(blurOf(textureSampleLevel(soft, smp, o.uv + vec2f(cos(a), sin(a)) * (1.5 + f32(i & 1) * 1.6) / size, 0.0).xyz)));
  }
  let gap = 64.0 * (1.0 - smoothstep(0.2, 0.9, own.y));
  var sum = vec3f(0.0);
  var cover = 0.0;
  var all = 0.0;
  for (var i = 0; i < select(0, NEAR, most > 0.6); i++) {
    let u = (f32(i) + 0.5) / f32(NEAR);
    let r = pow(u, INWARD) * REACH;
    let area = 2.0 * r * REACH * INWARD * pow(u, INWARD - 1.0) / f32(NEAR);
    let a = f32(i) * 2.39996323;
    let at = o.uv + vec2f(cos(a), sin(a)) * r / size;
    let q = textureSampleLevel(soft, smp, at, 0.0).xyz;
    var b = abs(blurOf(q));
    // what is behind doesn't spill over what is sharp in front
    if (b > 0.6 && q.z > 0.0 && b > ob) { b = min(b, ob * 2.0 + gap); }
    let reach = clamp(b - r + 1.0, 0.0, 1.0);
    let w = reach * area / (b * b + b + 0.3333);
    let m = smoothstep(0.7, 1.4, b) * (1.0 - wider(b * 0.5));
    sum += textureSampleLevel(sharp, smp, at, 0.0).rgb * w * m;
    cover += w * m;
    all += w;
  }
  let k = 1.0 / max(all, 1.0);
  let n = vec4f(sum * k, min(cover * k, 1.0));
  // the two blurred layers are of blurs apart, so they add; what is left of the pixel is its own, if it is sharp
  let covered = min(s.a + n.a, 1.0);
  let blurred = smoothstep(0.7, 1.4, ob);
  return vec4f(c * (1.0 - covered) * (1.0 - blurred * smoothstep(0.05, 0.6, covered)) + n.rgb + s.rgb, 1.0);
}
`;

export const nearLens = (code: string) => {
  const out = code.replace("let s = smoothstep(0.35, 0.8, b);", "let s = wider(b);").replace(/@group\(0\) @binding\(4\) var spread[\s\S]*$/, LAY);
  if (!out.includes("fn wider") || out.includes("smoothstep(0.35, 0.8, b)")) throw new Error("near-lens: lens.wgsl has changed");
  return out;
};

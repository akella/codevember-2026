// Without the networks, for comparison: what one would write by hand. Strands by Kajiya and Kay, shells by Lambert,
// under the same lamps and the same shadows of one cocoon on another; or not lit at all.
const SILK = vec3f(0.955, 0.94, 0.905);

// a lamp's direction in the body's own frame
fn lampAt(k: u32) -> vec3f {
  let d = shadow.lamps[k].xyz;
  return body.x.xyz * d.x + body.y.xyz * d.y + body.z.xyz * d.z;
}

// normal: of what it lies on, `lies` 1 if it lies on anything (its far side is then dark)
fn plainFibre(tangent: vec3f, view: vec3f, normal: vec3f, lies: f32, v: vec3f) -> vec3f {
  if (frame.spin.z > 1.5) { return SILK * 0.42; }
  let tv = dot(tangent, view);
  let sv = sqrt(max(1.0 - tv * tv, 0.0));
  var sum = vec3f(0.0);
  for (var k = 0u; k < 3u; k++) {
    let l = lampAt(k);
    let tl = dot(tangent, l);
    let sl = sqrt(max(1.0 - tl * tl, 0.0));
    let front = mix(1.0, clamp((dot(normal, l) + 0.15) / 1.15, 0.0, 1.0), lies);
    sum += shadow.colours[k].rgb * v[k] * front * (SILK * 0.75 * sl + 0.3 * pow(max(sl * sv - tl * tv, 0.0), 40.0));
  }
  return sum;
}

fn plainShell(normal: vec3f, v: vec3f) -> vec3f {
  if (frame.spin.z > 1.5) { return SILK * 0.28; }
  var sum = vec3f(0.0);
  for (var k = 0u; k < 3u; k++) { sum += shadow.colours[k].rgb * v[k] * max(dot(normal, lampAt(k)), 0.0); }
  return sum * SILK;
}

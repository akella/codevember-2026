  let n = i / kind.perCocoon;
  let s = shapes[n];
  let v = p - s.centre.xyz;
  let r = length(v);
  let d = v / r;
  if (dot(d, view) < -0.4) { return; }                 // the far side of its cocoon: hidden
  let own = vec3f(dot(s.x.xyz, d), dot(s.y.xyz, d), dot(s.z.xyz, d));
  let off = r / radial(s, own) - 1.0;
  let uv = vec2f(fract(atan2(own.z, own.y) / 6.28318530718), acos(clamp(own.x, -1.0, 1.0)) / 3.14159265359);
  let k = textureSampleLevel(detailTex, around, uv, n, 0.0) * 2.0 - 1.0;
  let normal = crinkled(s, own, k);
  var x: array<vec4f, 12>;
  for (var l = 0u; l < 4u; l++) { x[l] = textureSampleLevel(coarseTex, around, uv, n * 4u + l, 0.0) * 2.0 - 1.0; }
  for (var l = 0u; l < 2u; l++) { x[4u + l] = textureSampleLevel(fineTex, around, uv, n * 2u + l, 0.0) * 2.0 - 1.0; }
  x[6] = code2(i, t, 0u);
  x[7] = vec4f(d, view.x);
  x[8] = vec4f(view.yz, tangent.xy);
  x[9] = vec4f(tangent.z, normal);
  x[10] = vec4f(k.zw, dot(normal, tangent), dot(d, view));
  x[11] = vec4f(dot(tangent, view), t * 2.0 - 1.0, clamp(off * 12.0, -1.0, 3.0), 0.0);
  let c = run_on(&x);

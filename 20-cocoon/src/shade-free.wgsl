  var x: array<vec4f, 6>;
  for (var k = 0u; k < 3u; k++) { x[k] = code2(i, t, k); }
  x[3] = vec4f(p / 3.0, view.x);
  x[4] = vec4f(view.yz, tangent.xy);
  x[5] = vec4f(tangent.z, dot(tangent, view), t * 2.0 - 1.0, 0.0);
  let c = run_free(&x);

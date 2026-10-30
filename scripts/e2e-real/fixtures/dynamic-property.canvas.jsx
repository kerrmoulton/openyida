import React from 'react';

// Mirrors the minified Day.js access from issue #621.
function read(U, $, X) {
  return U === undefined ? this[$] : this.set(X, U);
}

export default function App() {
  const value = read.call({ result: '动态属性访问验证通过：this[$] = 2026-10-18' }, undefined, 'result');
  return <main style={{ padding: 32, background: '#fff', color: '#172033', fontFamily: 'sans-serif' }}>
    <h1>Canvas 动态属性回归验证</h1>
    <p data-testid="dynamic-property-result">{value}</p>
    <p>验证局部变量 $ 用于计算属性时，能够完成编译、发布和页面运行。</p>
  </main>;
}

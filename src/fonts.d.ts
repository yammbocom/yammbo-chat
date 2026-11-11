// wrangler [[rules]] type = "Data" turns these imports into ArrayBuffers.
declare module '*.woff2' {
  const data: ArrayBuffer;
  export default data;
}
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}

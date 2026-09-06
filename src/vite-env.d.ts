/// <reference types="vite/client" />

declare module '*.frag?raw' {
  const src: string;
  export default src;
}
declare module '*.css?raw' {
  const src: string;
  export default src;
}

/**
 * Minimal declaration for the one entry point we call.
 *
 * `@types/draco3dgltf` does not exist, and a bare `declare module 'draco3dgltf'`
 * would type the whole thing as `any` — which the package forbids. Declaring
 * only what is used keeps the ban on `any` intact and makes an unexpected API
 * change surface as a type error rather than silently.
 *
 * The encoder module is handed straight to gltf-transform, which knows its
 * shape; we never call into it ourselves, so `unknown` is the honest type.
 */
declare module 'draco3dgltf' {
  interface Draco3dGltf {
    createEncoderModule(): Promise<unknown>;
    createDecoderModule(): Promise<unknown>;
  }
  const draco3d: Draco3dGltf;
  export default draco3d;
}

/// <reference types="astro/client" />
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
declare namespace App {
  interface Locals {
    actor?: string;
    csrf?: string;
  }
}

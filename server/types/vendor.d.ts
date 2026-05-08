// Type declarations for packages that don't ship their own types.
declare module "@foile/crypto-pay-api" {
  export class CryptoPay {
    constructor(token: string, options?: Record<string, unknown>);
    [key: string]: any;
  }
  export const Assets: Record<string, string>;
}

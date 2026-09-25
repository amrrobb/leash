// Stand-in for IDKit's browser build. The test drives World App's answer through window.__world.
(() => {
  const request = (opts) => {
    const req = {
      connectorURI: "https://world.org/verify?t=e2e",
      requestId: "e2e",
      pollUntilCompletion: () =>
        new Promise((resolve) => {
          window.__world = {
            approve: (identifier = "selfie", nullifier = "0xalice") =>
              resolve({
                success: true,
                result: {
                  protocol_version: "4.0",
                  nonce: opts.rp_context.nonce,
                  action: opts.action,
                  responses: [{ identifier, nullifier, proof: [], issuer_schema_id: 11, expires_at_min: 0 }],
                  environment: "staging",
                },
              }),
            decline: () => resolve({ success: false, error: "user_rejected" }),
          };
        }),
    };
    return { constraints: async () => req, preset: async () => req };
  };
  window.IDKit = { request, any: (...n) => ({ any: n }), CredentialRequest: (t) => ({ t }) };
})();

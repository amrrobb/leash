// Stand-in for IDKit's browser build. The test drives World App's answer through window.__world.
(() => {
  const request = (opts) => {
    // window.__legacyPhone = true makes a constraints request fail like a World ID 3.0 phone; presets still work.
    const req = (viaPreset, preset) => ({
      connectorURI: "https://world.org/verify?t=e2e",
      requestId: "e2e",
      preset,
      pollUntilCompletion: () =>
        new Promise((resolve) => {
          if (window.__legacyPhone && !viaPreset) return resolve({ success: false, error: "world_id_4_not_available" });
          window.__world = {
            approve: (identifier = "selfie", nullifier = "0xalice") =>
              resolve({
                success: true,
                result: {
                  protocol_version: viaPreset && window.__legacyPhone ? "3.0" : "4.0",
                  nonce: opts.rp_context.nonce,
                  action: opts.action,
                  responses: [{ identifier, nullifier, proof: [], issuer_schema_id: 11, expires_at_min: 0 }],
                  environment: "staging",
                },
              }),
            decline: () => resolve({ success: false, error: "user_rejected" }),
          };
        }),
    });
    return { constraints: async () => req(false), preset: async (p) => req(true, p) };
  };
  const preset = (type) => () => ({ type });
  window.IDKit = { request, any: (...n) => ({ any: n }), CredentialRequest: (t) => ({ t }), proofOfHuman: preset("ProofOfHuman"), passport: preset("Passport"), selfieCheck: preset("SelfieCheck"), selfieCheckLegacy: preset("SelfieCheckLegacy") };
})();

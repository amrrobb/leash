# Leash — handoff untuk hacking

> Permission for an AI agent that shrinks on its own unless a verified human keeps showing up.

Event: ETHGlobal Tokyo, 25–27 Sep 2026. Solo. Jalur From Scratch.
Target: ENS "Best Use of ENSv2" $6k · World "Best Use of IDKit" $7.5k · 1inch "Build an Aqua App" $5k.

**Aturan:** semua kode ditulis mulai sekarang. Folder `v0-mandate/` adalah catatan eksplorasi — boleh dibaca, jangan disalin. Commit kecil dan sering sejak commit pertama.

---

## 1. Cerita dalam 30 detik

Alice punya token. Dia mau agent mengelola posisinya di 1inch Aqua. Strategi Aqua tidak bisa diubah — cara mengubahnya `dock()` lalu `ship()`. Siapa pun yang bisa `dock` bisa menarik seluruh saldo virtual. Jadi agent butuh izin, dan izin itu harus punya batas yang hidup.

Mandat: role di nama ENS milik Alice, plafon yang **menyusut sendiri** sejak Alice terakhir membuktikan dirinya lewat World. Agent selalu boleh menutup posisi, hanya boleh membuka kalau izin masih hidup. Trade dari pasar terhadap posisi Alice dipangkas oleh opcode SwapVM sesuai plafon yang tersisa.

## 2. Arsitektur

```
Alice (1 halaman) → World IDKit → Backend ──┬─ grantRoles → ENSv2 registry (Sepolia)
                                            └─ verify()   → Vault.lastVerified

Agent (skrip) → Vault.ship()/dock() → Aqua (Vault = maker, token di Vault)
Taker (pasar) → Router+MandateGate (opcode 0x2f) → baca ENS + Vault.clock → pangkas amount
```

Yang ditulis sendiri: **Vault.sol**, **MandateGate.sol** (library), **MandateAquaRouter.sol**, **backend** (Node), **frontend** (1 halaman). Sisanya sudah ada.

## 3. Kontrak

### Vault.sol (tulis pertama — belum pernah diuji)
```solidity
contract Vault {
  address immutable owner;          // Alice
  IAqua   immutable aqua;
  IEAC    immutable ens;            // registry milik alice (UserRegistry proxy)
  string  agentLabel;               // "agent"  -> findTokenId(agentLabel)
  uint64  public lastVerified;      // ditulis backend (onlyBackend)
  uint256 constant ROLE_MANDATE = 1 << 40;

  function ship(bytes strategy, IERC20[] tokens, uint256[] amounts) external {
    require(ens.hasRoles(ens.findTokenId(agentLabel), ROLE_MANDATE, msg.sender), "no mandate");
    require(capNow() > 0, "mandate empty");
    aqua.ship(...);                  // Vault adalah msg.sender -> maker
  }
  function dock(bytes32 strategyHash) external { require(msg.sender==agent||msg.sender==owner); aqua.dock(...); }
  function withdraw(IERC20 t, uint256 a) external onlyOwner;
  function verify() external onlyBackend { lastVerified = uint64(block.timestamp); }
  function capNow() public view returns (uint256) { return limitAt(baseCap(), block.timestamp - lastVerified); }
}
```
Buka pertanyaan ke mentor 1inch pagi ini: **Vault sebagai maker (bukan EOA) sah?**

### MandateGate.sol — sudah terbukti di v0 (8 test + 5 test dengan ENS asli)
- Opcode slot `Opcode._2f` (kosong; 0x2e dipakai Glasshouse).
- Args (120 byte): `[registry 20][tokenId 32][roleMask 32][cap uint128 16][clock 20]`.
- Baca `ctx.query.maker`, `ctx.swap.amountIn/amountOut`, `ctx.query.isExactIn`.
- `require(hasRoles)` → `MandateRevoked`; `limit==0` → `MandateEmpty`; selain itu pangkas register.
- Peluruhan: `base >> (elapsed/24h)` lalu interpolasi linear: `base - base*(elapsed%24h)/(48h)`. Tanpa cabang; shift ≥256 otomatis nol.
- Read-only; jangan tulis storage (isStaticContext true saat quote).

### MandateAquaRouter.sol
```solidity
contract MandateAquaRouter is Simulator, SwapVM, AquaOpcodes {
  function _dispatch(Context memory c, uint256 op, bytes calldata a) internal override { _runOpcode(c, op, a); }
  function _runOpcode(Context memory c, uint256 op, bytes calldata a) internal override {
    if (op == MandateGate.opcode.asU8()) MandateGate.exec(c, a); else super._runOpcode(c, op, a);
  }
}
```
Pakai **branch `main`** swap-vm (API `_runOpcode`). Tag v1.0.2 memakai `_opcodes()` array — beda.
Ukuran terukur: 21.313 B (batas 24.576). Cek `forge build --sizes` tiap build.

### Program strategi (urutan wajib)
`FeeProtocol` (harus pertama) → `MandateGate` → `XYCSwap` → `Salt`. Deadline opsional sebagai jaring pengaman.

## 4. ENSv2 — fakta terverifikasi

- Registry asli: `PermissionedRegistry`; `hasRoles(anyId, bitmap, account)`.
- **Pola kepemilikan:** nama `agent.alice.eth` didaftarkan ke **Alice** dengan admin bits `(role<<128)`; lalu `grantRoles(tokenId, ROLE_MANDATE|ROLE_TIER_x, agent)`. Kalau nama diberikan ke agent, Alice tidak bisa mencabut.
- Admin bit untuk nybble kustom **harus dibawa saat `register()`** — `grantRoles` admin setelahnya gagal (`EACCannotGrantRoles`).
- **tokenId berubah** setelah grant/revoke. Selalu `findTokenId(label)`. `hasRoles` masih menerima id lama.
- Expiry menghapus semua role otomatis (`eacVersionId+1`). Tidak perlu cek tambahan.
- Role bits: 40 mandate · 44 orb · 48 document · 52 selfie. Tidak bentrok dengan RegistryRolesLib.
- Gas `hasRoles` ≈ 24.4k; overhead per swap ≈ 25.7k (129k → 155k).
- Alamat Sepolia (redeploy 15 Sep, cek `deployments/sepolia/*.json` dulu):
  ETHRegistry `0x1bd29e26f09b4c68c623141673e5f0a5d02709f6` · UserRegistryImpl `0xb146a81b83ac63065aeafa16f25971f70176143e` · PermissionedResolverImpl `0x742b36ef4c9f0d8b9af99a1be555200e09d6ecc0` · MockUSDC `0xf9a8540590bc66a2b98692cd6d20f122d947c752`.
- Registrasi dibayar USDC testnet (mintable). Initializer UserRegistry berbentuk `Grant[]`.
- Alice butuh UserRegistry sendiri (via VerifiableFactory) untuk nama `alice.eth` → subname agent di situ.

## 5. World IDKit v4 — fakta terverifikasi

Paket `@worldcoin/idkit-core@4.3.0`. API BEDA dari docs lama:
- Backend: `signRequest({action, signingKeyHex})` → `rp_context {rp_id, nonce, created_at, expires_at, signature}`. Murni JS.
- Frontend: `IDKit.request({app_id, action, rp_context, allow_legacy_proofs:false}).preset(selfieCheck({signal}))` → `connectorURI` (QR) → `pollUntilCompletion()`.
- Backend: `POST https://developer.world.org/api/v4/verify/{rp_id}` dengan `completion.result` **apa adanya** → `{success, nullifier, credential_type}`.
- Simpan nullifier di **SQLite/file**, bukan memori (replay lolos setelah restart).
- Tier → cap: selfie 2.000 · document 7.500 · orb 15.000. Nilai `credential_type` asli **belum dikonfirmasi** — cek di sandbox pagi ini.
- Setelah verify: 2 tx — `registry.grantRoles(tokenId, tierBit, agent)` + `vault.verify()`.
- Selfie Check = Beta. Jangan klaim uniqueness.
- Wajib: pilot/staging resmi (mock tidak eligible), video demo, path gagal, **integration debrief** (catat friksi sambil jalan).

## 6. Urutan 36 jam

| Jam | Kerja | Titik potong |
|---|---|---|
| 0–2 | repo, commit 1, tanya mentor (1inch: Vault sebagai maker? ENS: alamat? World: rp_id/staging) | — |
| 2–8 | **Vault** + ship/dock ke Aqua di Anvil fork Sepolia | gagal → agent = EOA maker, Alice = LP biasa (lebih lemah) |
| 8–13 | ENS: UserRegistry Alice, subname agent, grant/revoke, Vault baca hasRoles | gagal → policy di Vault, ENS jadi publikasi |
| 13–18 | Backend World + 2 tx; UI keadaan 2 (dashboard) | — |
| 18–22 | **Tidur** | tidak bisa dipotong |
| 22–28 | Router + opcode, deploy Sepolia | J28 gagal → lepas 1inch |
| 28–31 | UI keadaan 1 & 3, polish | — |
| 31–34 | submission + checklist | jangan geser |
| 34–36 | latihan demo ×3 | — |

Dev: `anvil --fork-url $SEPOLIA_QUICKNODE --chain-id 11155111`. Final: Sepolia asli.

## 7. Submission checklist

- [ ] Repo publik, live link, commit bertahap, atribusi AI tools + prompt/spec files
- [ ] 1inch: "Powered by SwapVM — © Degensoft Ltd 2025" · token transfer terlihat di demo · Aqua/SwapVM resmi (redeploy diizinkan)
- [ ] ENS: Sepolia · ENSv2 sentral · tanpa hardcode
- [ ] World: ≥1 credential · verify di server · trust moment dijelaskan · path sukses + path gagal · Beta disebut · video · debrief

## 8. Demo 90 detik

Pembuka: *"Aqua strategies can't be edited, so someone has to keep closing and reopening them. Whoever does that holds the key to your money. We make that key shrink on its own when the human stops showing up."*

1. Alice verifies with World → cap appears by tier
2. Agent ships a position through the Vault
3. Cap visibly drops while you talk (demo clock 1s = 4h)
4. A market trade asks 10,000 → 3,200 fills
5. Cap hits zero → agent can't open, still closes
6. Alice re-verifies → cap restored

Jalur gagal untuk World: Alice batal di QR → tidak ada tx, plafon tetap turun.

## 9. Kalimat pembeda (hafal)

- vs Doca/Harbormaster: *the one running the loop isn't the owner, and its authority runs out.*
- vs `Decay` opcode: *Decay shrinks what's offered; ours shrinks what's still allowed.*
- vs built-in guards: *guards say yes or no; ours says how much.*
- vs subfloor: *a signature can't be revoked; a live role can, and anyone can read it.*
- "Why World?": *without it the agent would renew its own permission.*

## 10. Jebakan yang sudah dibayar mahal

- solc: swap-vm 0.8.30 via-IR; ENS 0.8.25. Tidak bisa satu compile — pakai fork Anvil.
- Kompilasi seluruh test swap-vm >20 menit. `FOUNDRY_TEST=test/x FOUNDRY_SCRIPT=nonexistent`.
- Pemangkasan butuh taker `allowPartialFill=true`, kalau tidak revert.
- `FeeProtocol` wajib instruksi pertama.
- Anvil mati saat shell tutup: `setsid nohup anvil ... &`.
- Nama produk di UI: yang dipangkas adalah **trade pasar**, bukan aksi agent.

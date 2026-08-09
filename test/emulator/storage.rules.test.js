/* =====================================================================
   TESTES — storage.rules.txt (Firebase Emulator, via `npm run test:emulator`)
   ===================================================================== */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-metodo-aprender",
    storage: {
      rules: readFileSync("storage.rules.txt", "utf8"),
      host: "127.0.0.1",
      port: 9199
    }
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

afterEach(async () => {
  await testEnv.clearStorage();
});

function storageAs(uid) {
  return uid ? testEnv.authenticatedContext(uid).storage() : testEnv.unauthenticatedContext().storage();
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

describe("storage.rules.txt", () => {
  it("dono envia um PDF válido dentro da própria pasta", async () => {
    const alice = storageAs("alice");
    const fileRef = ref(alice, "users/alice/materials/mat1/original.pdf");
    await assertSucceeds(uploadBytes(fileRef, PDF_BYTES, { contentType: "application/pdf" }));
  });

  it("bloqueia envio de arquivo que não é PDF", async () => {
    const alice = storageAs("alice");
    const fileRef = ref(alice, "users/alice/materials/mat1/original.pdf");
    await assertFails(uploadBytes(fileRef, PDF_BYTES, { contentType: "image/png" }));
  });

  it("bloqueia arquivo maior que 50MB", async () => {
    const alice = storageAs("alice");
    const fileRef = ref(alice, "users/alice/materials/mat1/original.pdf");
    const big = new Uint8Array(51 * 1024 * 1024);
    await assertFails(uploadBytes(fileRef, big, { contentType: "application/pdf" }));
  }, 30000);

  it("bloqueia envio na pasta de outra pessoa", async () => {
    const alice = storageAs("alice");
    const fileRef = ref(alice, "users/bob/materials/mat1/original.pdf");
    await assertFails(uploadBytes(fileRef, PDF_BYTES, { contentType: "application/pdf" }));
  });

  it("bloqueia quem não está autenticado", async () => {
    const anon = storageAs(null);
    const fileRef = ref(anon, "users/alice/materials/mat1/original.pdf");
    await assertFails(uploadBytes(fileRef, PDF_BYTES, { contentType: "application/pdf" }));
  });

  it("dono lê o próprio arquivo; outra pessoa não lê", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "users/alice/materials/mat1/original.pdf"), PDF_BYTES, { contentType: "application/pdf" });
    });

    await assertSucceeds(getBytes(ref(storageAs("alice"), "users/alice/materials/mat1/original.pdf")));
    await assertFails(getBytes(ref(storageAs("bob"), "users/alice/materials/mat1/original.pdf")));
  });

  it("dono exclui o próprio arquivo; outra pessoa não consegue excluir", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "users/alice/materials/mat1/original.pdf"), PDF_BYTES, { contentType: "application/pdf" });
    });

    await assertFails(deleteObject(ref(storageAs("bob"), "users/alice/materials/mat1/original.pdf")));
    await assertSucceeds(deleteObject(ref(storageAs("alice"), "users/alice/materials/mat1/original.pdf")));
  });
});

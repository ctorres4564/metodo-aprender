/* =====================================================================
   TESTES — firestore.rules.txt (Firebase Emulator, via `npm run test:emulator`)
   =====================================================================
   Cobre o isolamento entre usuários e as restrições de campo que hoje só
   eram conferidas manualmente (ver README, seção "Verificação manual de
   isolamento entre usuários").
   ===================================================================== */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-metodo-aprender",
    firestore: {
      rules: readFileSync("firestore.rules.txt", "utf8"),
      host: "127.0.0.1",
      port: 8085
    }
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

function dbAs(uid) {
  return uid ? testEnv.authenticatedContext(uid).firestore() : testEnv.unauthenticatedContext().firestore();
}

// Escreve direto no Firestore Emulator ignorando as regras — só pra
// preparar o estado ("seed") antes de testar se a regra bloqueia/libera.
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

describe("firestore.rules.txt", () => {
  describe("progress/{docId}", () => {
    it("dono lê e escreve o próprio progresso (id começa com o próprio uid)", async () => {
      const alice = dbAs("alice");
      await assertSucceeds(setDoc(doc(alice, "progress/alice_modulo1"), { done: true }));
      await assertSucceeds(getDoc(doc(alice, "progress/alice_modulo1")));
    });

    it("outra pessoa não lê nem escreve o progresso alheio", async () => {
      await seed((db) => setDoc(doc(db, "progress/alice_modulo1"), { done: true }));
      const bob = dbAs("bob");
      await assertFails(getDoc(doc(bob, "progress/alice_modulo1")));
      await assertFails(setDoc(doc(bob, "progress/alice_modulo1"), { done: false }));
    });

    it("sem login, tudo bloqueado", async () => {
      const anon = dbAs(null);
      await assertFails(setDoc(doc(anon, "progress/alice_modulo1"), { done: true }));
    });
  });

  describe("modules/{docId}", () => {
    it("cria só com ownerId igual ao uid autenticado", async () => {
      const alice = dbAs("alice");
      await assertSucceeds(setDoc(doc(alice, "modules/m1"), { ownerId: "alice", title: "X" }));
      await assertFails(setDoc(doc(alice, "modules/m2"), { ownerId: "bob", title: "X" }));
    });

    it("só o dono lê, edita e exclui", async () => {
      await seed((db) => setDoc(doc(db, "modules/m1"), { ownerId: "alice", title: "X" }));

      const bob = dbAs("bob");
      await assertFails(getDoc(doc(bob, "modules/m1")));
      await assertFails(updateDoc(doc(bob, "modules/m1"), { title: "hackeado" }));
      await assertFails(deleteDoc(doc(bob, "modules/m1")));

      const alice = dbAs("alice");
      await assertSucceeds(getDoc(doc(alice, "modules/m1")));
      await assertSucceeds(updateDoc(doc(alice, "modules/m1"), { title: "Novo título" }));
    });

    it("ownerId é imutável no update (não dá pra 'transferir' o módulo)", async () => {
      await seed((db) => setDoc(doc(db, "modules/m1"), { ownerId: "alice", title: "X" }));
      const alice = dbAs("alice");
      await assertFails(updateDoc(doc(alice, "modules/m1"), { ownerId: "bob" }));
    });
  });

  describe("users/{uid}", () => {
    it("cria só o próprio documento, só com os campos email/remindersEnabled", async () => {
      const alice = dbAs("alice");
      await assertSucceeds(setDoc(doc(alice, "users/alice"), { email: "a@x.com", remindersEnabled: true }));
      await assertFails(setDoc(doc(alice, "users/bob"), { email: "a@x.com" }));
    });

    it("cliente não consegue criar nem alterar o campo 'plan'", async () => {
      const alice = dbAs("alice");
      await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@x.com", plan: "premium" }));

      await seed((db) => setDoc(doc(db, "users/alice"), { email: "a@x.com", remindersEnabled: false }));
      await assertFails(updateDoc(doc(alice, "users/alice"), { plan: "premium" }));
      await assertSucceeds(updateDoc(doc(alice, "users/alice"), { remindersEnabled: true }));
    });

    it("só o próprio uid lê o perfil", async () => {
      await seed((db) => setDoc(doc(db, "users/alice"), { email: "a@x.com" }));
      const bob = dbAs("bob");
      await assertFails(getDoc(doc(bob, "users/alice")));
    });
  });

  describe("ai_usage/{docId}", () => {
    it("só leitura, e só do próprio uid (id precisa começar com o uid)", async () => {
      await seed((db) => setDoc(doc(db, "ai_usage/alice_2026-08"), { count: 5 }));
      await assertSucceeds(getDoc(doc(dbAs("alice"), "ai_usage/alice_2026-08")));
      await assertFails(getDoc(doc(dbAs("bob"), "ai_usage/alice_2026-08")));
    });

    it("cliente nunca escreve no contador (só o servidor, via Admin SDK)", async () => {
      await assertFails(setDoc(doc(dbAs("alice"), "ai_usage/alice_2026-08"), { count: 999 }));
    });
  });

  describe("materials/{materialId}", () => {
    it("só o dono lê; ninguém escreve pelo cliente (só o servidor)", async () => {
      await seed((db) => setDoc(doc(db, "materials/mat1"), { ownerId: "alice", title: "Livro" }));

      await assertSucceeds(getDoc(doc(dbAs("alice"), "materials/mat1")));
      await assertFails(updateDoc(doc(dbAs("alice"), "materials/mat1"), { status: "ready" }));
      await assertFails(getDoc(doc(dbAs("bob"), "materials/mat1")));
    });

    describe("pages/{pageId}", () => {
      it("só quem é dono do material pai lê/escreve as páginas", async () => {
        await seed((db) => setDoc(doc(db, "materials/mat1"), { ownerId: "alice" }));

        await assertSucceeds(setDoc(doc(dbAs("alice"), "materials/mat1/pages/p1"), { text: "..." }));
        await assertFails(setDoc(doc(dbAs("bob"), "materials/mat1/pages/p1"), { text: "hack" }));
        await assertFails(getDoc(doc(dbAs("bob"), "materials/mat1/pages/p1")));
      });
    });

    describe("highlights/{highlightId}", () => {
      it("cria só com ownerId/materialId corretos e material pertencente ao mesmo uid", async () => {
        await seed(async (db) => {
          await setDoc(doc(db, "materials/mat1"), { ownerId: "alice" });
          await setDoc(doc(db, "materials/mat2"), { ownerId: "bob" });
        });
        const alice = dbAs("alice");

        await assertSucceeds(setDoc(doc(alice, "materials/mat1/highlights/h1"), {
          ownerId: "alice", materialId: "mat1", color: "yellow", createdAt: 1
        }));

        // ownerId forjado (diferente de quem está autenticado)
        await assertFails(setDoc(doc(alice, "materials/mat1/highlights/h2"), {
          ownerId: "bob", materialId: "mat1", color: "yellow", createdAt: 1
        }));

        // o material referenciado pertence a outra pessoa
        await assertFails(setDoc(doc(alice, "materials/mat2/highlights/h3"), {
          ownerId: "alice", materialId: "mat2", color: "yellow", createdAt: 1
        }));
      });

      it("update só pode mudar color/position/updatedAt — o resto é imutável", async () => {
        await seed(async (db) => {
          await setDoc(doc(db, "materials/mat1"), { ownerId: "alice" });
          await setDoc(doc(db, "materials/mat1/highlights/h1"), { ownerId: "alice", materialId: "mat1", color: "yellow", createdAt: 1 });
        });
        const alice = dbAs("alice");

        await assertSucceeds(updateDoc(doc(alice, "materials/mat1/highlights/h1"), { color: "green", updatedAt: 2 }));
        await assertFails(updateDoc(doc(alice, "materials/mat1/highlights/h1"), { ownerId: "bob" }));
        await assertFails(updateDoc(doc(alice, "materials/mat1/highlights/h1"), { createdAt: 999 }));
        await assertFails(updateDoc(doc(dbAs("bob"), "materials/mat1/highlights/h1"), { color: "blue" }));
      });

      it("só o dono exclui", async () => {
        await seed(async (db) => {
          await setDoc(doc(db, "materials/mat1"), { ownerId: "alice" });
          await setDoc(doc(db, "materials/mat1/highlights/h1"), { ownerId: "alice", materialId: "mat1", color: "yellow", createdAt: 1 });
        });

        await assertFails(deleteDoc(doc(dbAs("bob"), "materials/mat1/highlights/h1")));
        await assertSucceeds(deleteDoc(doc(dbAs("alice"), "materials/mat1/highlights/h1")));
      });
    });

    describe("notes/{noteId}", () => {
      it("cria só se o highlight referenciado também pertencer ao mesmo uid/material", async () => {
        await seed(async (db) => {
          await setDoc(doc(db, "materials/mat1"), { ownerId: "alice" });
          await setDoc(doc(db, "materials/mat1/highlights/h1"), { ownerId: "alice", materialId: "mat1", color: "yellow", createdAt: 1 });
        });
        const alice = dbAs("alice");

        await assertSucceeds(setDoc(doc(alice, "materials/mat1/notes/n1"), {
          ownerId: "alice", materialId: "mat1", highlightId: "h1", text: "nota", createdAt: 1
        }));

        // highlightId aponta pra um destaque que não existe (nunca pode ficar "solta")
        await assertFails(setDoc(doc(alice, "materials/mat1/notes/n2"), {
          ownerId: "alice", materialId: "mat1", highlightId: "inexistente", text: "nota", createdAt: 1
        }));
      });

      it("update só pode mudar text/updatedAt/linkedModuleId/linkedConceptId", async () => {
        await seed(async (db) => {
          await setDoc(doc(db, "materials/mat1"), { ownerId: "alice" });
          await setDoc(doc(db, "materials/mat1/highlights/h1"), { ownerId: "alice", materialId: "mat1", color: "yellow", createdAt: 1 });
          await setDoc(doc(db, "materials/mat1/notes/n1"), { ownerId: "alice", materialId: "mat1", highlightId: "h1", text: "nota", createdAt: 1 });
        });
        const alice = dbAs("alice");

        await assertSucceeds(updateDoc(doc(alice, "materials/mat1/notes/n1"), { text: "editada", updatedAt: 2 }));
        await assertFails(updateDoc(doc(alice, "materials/mat1/notes/n1"), { highlightId: "outro" }));
      });
    });
  });
});

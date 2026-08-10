/* =====================================================================
   Global setup do Playwright — roda UMA VEZ antes de todos os specs.
   =====================================================================
   Semeia, direto no Firebase Emulator (via o mesmo api/_lib/firebaseAdmin.js
   usado pelas funções serverless — reaproveita o branch de emulador já
   testado nas Fases 2/3), um usuário com e-mail já verificado (testar o
   fluxo de verificação de e-mail de verdade por UI exigiria clicar num
   link de e-mail real, fora do escopo aqui) e um material com PDF, pro
   spec do leitor não depender de nenhum fluxo de importação/IA.
   ===================================================================== */
import { SEEDED_MATERIAL_ID, SEEDED_USER } from "./fixtures.js";

export default async function globalSetup() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Rode via `npm run test:e2e` — os testes E2E precisam do Firebase Emulator.");
  }

  const { adminAuth, adminDb, adminStorage } = await import("../../api/_lib/firebaseAdmin.js");

  await adminAuth().createUser({
    uid: SEEDED_USER.uid,
    email: SEEDED_USER.email,
    password: SEEDED_USER.password,
    emailVerified: true
  });

  await adminDb().collection("users").doc(SEEDED_USER.uid).set({
    email: SEEDED_USER.email,
    plan: "free"
  });

  await adminDb().collection("materials").doc(SEEDED_MATERIAL_ID).set({
    ownerId: SEEDED_USER.uid,
    title: "Material de teste E2E",
    sourceType: "pdf",
    status: "ready",
    pageCount: 1,
    storagePath: `users/${SEEDED_USER.uid}/materials/${SEEDED_MATERIAL_ID}/original.pdf`
  });

  await adminStorage()
    .file(`users/${SEEDED_USER.uid}/materials/${SEEDED_MATERIAL_ID}/original.pdf`)
    .save(buildMinimalPdf(), { contentType: "application/pdf" });
}

// PDF mínimo válido de 1 página em branco — o suficiente pro PDF.js
// conseguir abrir e renderizar (não precisa ter texto/conteúdo real pro
// que o spec do leitor verifica: navegação, zoom, modo escuro). Os
// offsets do xref são calculados a partir do tamanho real de cada parte
// (nunca digitados à mão) — um xref com offset errado faz o PDF.js
// falhar ao abrir silenciosamente, deixando a página em branco.
function buildMinimalPdf() {
  const header = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>\nendobj\n"
  ];

  let offset = header.length;
  const offsets = [];
  for (const obj of objects) {
    offsets.push(offset);
    offset += obj.length;
  }
  const xrefOffset = offset;

  const pad = (n) => String(n).padStart(10, "0");
  let xref = `xref\n0 ${objects.length + 1}\n${pad(0)} 65535 f \n`;
  for (const off of offsets) xref += `${pad(off)} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + objects.join("") + xref + trailer, "latin1");
}

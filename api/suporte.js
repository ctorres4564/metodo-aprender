/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — Processa mensagens de suporte e feedback
   enviadas por usuários autenticados, disparando um e-mail para o
   desenvolvedor/suporte através da API da Resend.
   =====================================================================
   Recebe: { subject, message }
   Retorna: { success: true }

   Variáveis de ambiente:
   - RESEND_API_KEY: chave da API Resend (obrigatória).
   - REMINDER_FROM_EMAIL: e-mail de origem (opcional; padrão onboarding@resend.dev).
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { withSentry } from "./_lib/sentry.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const SUPPORT_DESTINATION_EMAIL = "ctorres4564@gmail.com";
const FROM_EMAIL = process.env.REMINDER_FROM_EMAIL || "onboarding@resend.dev";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const user = await verifyUserFromRequest(req);
  if (!user || !user.uid) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  const { subject, message } = req.body || {};

  if (!subject || typeof subject !== "string" || subject.trim().length < 3) {
    res.status(400).json({ error: "Assunto inválido (mínimo de 3 caracteres)." });
    return;
  }

  if (!message || typeof message !== "string" || message.trim().length < 10) {
    res.status(400).json({ error: "Mensagem muito curta (mínimo de 10 caracteres)." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Serviço de e-mail não configurado no servidor (RESEND_API_KEY ausente)." });
    return;
  }

  const cleanSubject = subject.trim().replace(/\s+/g, " ").slice(0, 100);
  const cleanMessage = message.trim().slice(0, 4000);

  const emailHtml = `
    <h2>Nova solicitação de suporte</h2>
    <p><strong>Usuário (UID):</strong> ${user.uid}</p>
    <p><strong>E-mail do Usuário:</strong> ${user.email || "(não informado)"}</p>
    <p><strong>Assunto:</strong> ${cleanSubject}</p>
    <hr />
    <p><strong>Mensagem:</strong></p>
    <p style="white-space: pre-wrap; background: #f5f5f5; padding: 15px; border-radius: 8px; border: 1px solid #ddd;">${cleanMessage}</p>
  `;

  try {
    const resp = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: SUPPORT_DESTINATION_EMAIL,
        subject: `[Suporte Método Aprender] ${cleanSubject}`,
        html: emailHtml,
        reply_to: user.email || undefined
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Resend respondeu status ${resp.status}: ${errText}`);
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Erro ao enviar e-mail de suporte:", e);
    res.status(502).json({ error: "Não foi possível enviar a mensagem de suporte agora. Tente novamente mais tarde." });
  }
}

export default withSentry(handler);

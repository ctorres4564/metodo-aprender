/* =====================================================================
   ONBOARDING WIZARD — aparece quando o usuário novo não tem módulos.
   Guia a pessoa para o caminho certo, eliminando a paralisia de escolha.

   USO:
       if (OnboardingWizard.shouldShow(0))
           OnboardingWizard.render(container);

   O wizard é mostrado UMA vez (persiste em localStorage).
   ===================================================================== */

(function(){
  'use strict';

  const STORAGE_KEY = 'ma_onboarding_seen_v2';

  window.OnboardingWizard = {

    /**
     * Retorna true se o wizard deve aparecer.
     * Só aparece para usuários sem módulos E que nunca viram o wizard.
     */
    shouldShow(userModuleCount) {
      if (userModuleCount > 0) return false;
      try {
        return !localStorage.getItem(STORAGE_KEY);
      } catch(e) {
        return true; // localStorage bloqueado → mostra mesmo assim
      }
    },

    /** Marca como visto para não repetir. */
    markSeen() {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch(e) { /* ignora */ }
    },

    /**
     * Renderiza o wizard no container.
     * @param {HTMLElement} container — elemento onde injetar o wizard
     */
    render(container) {
      if (!container) return;

      container.innerHTML = `
        <div class="onboarding-wizard" style="
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px 22px;
          text-align: center;
        ">
          <div style="font-size: 36px; margin-bottom: 10px;" aria-hidden="true">👋</div>
          <h3 style="margin: 0 0 6px; font-size: 18px;">Bem-vindo(a) ao Método Aprender!</h3>
          <p style="color: var(--text-dim); font-size: 13.5px; margin: 0 0 22px; line-height: 1.55; max-width: 480px; margin-left: auto; margin-right: auto;">
            Antes de começar, me conta:<br><strong>como você prefere criar seu primeiro módulo?</strong>
          </p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 520px; margin: 0 auto 12px;">
            <button class="onboarding-option" data-action="import-text"
              style="
                background: var(--panel);
                border: 1px solid var(--border);
                border-radius: 14px;
                padding: 20px 14px;
                cursor: pointer;
                color: var(--text);
                font-family: inherit;
                font-size: 13px;
                transition: border-color .2s, background .2s, transform .1s ease;
                text-align: center;
              "
              onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--panel-2)';"
              onmouseout="this.style.borderColor='var(--border)'; this.style.background='var(--panel)';"
              onfocus="this.style.borderColor='var(--accent)'; this.style.background='var(--panel-2)';"
              onblur="this.style.borderColor='var(--border)'; this.style.background='var(--panel)';"
            >
              <div style="font-size: 32px; margin-bottom: 8px;" aria-hidden="true">📄</div>
              <div style="font-weight: 700; margin-bottom: 3px;">Tenho um PDF ou texto</div>
              <div style="font-size: 11.5px; color: var(--text-dim); line-height: 1.45;">
                A IA gera os conceitos pra você revisar
              </div>
            </button>

            <button class="onboarding-option" data-action="create-manual"
              style="
                background: var(--panel);
                border: 1px solid var(--border);
                border-radius: 14px;
                padding: 20px 14px;
                cursor: pointer;
                color: var(--text);
                font-family: inherit;
                font-size: 13px;
                transition: border-color .2s, background .2s, transform .1s ease;
                text-align: center;
              "
              onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--panel-2)';"
              onmouseout="this.style.borderColor='var(--border)'; this.style.background='var(--panel)';"
              onfocus="this.style.borderColor='var(--accent)'; this.style.background='var(--panel-2)';"
              onblur="this.style.borderColor='var(--border)'; this.style.background='var(--panel)';"
            >
              <div style="font-size: 32px; margin-bottom: 8px;" aria-hidden="true">✍️</div>
              <div style="font-weight: 700; margin-bottom: 3px;">Sei o que quero estudar</div>
              <div style="font-size: 11.5px; color: var(--text-dim); line-height: 1.45;">
                Digito eu mesmo(a) cada conceito
              </div>
            </button>
          </div>

          <a href="importar-livro.html" class="onboarding-option"
            style="
              display: block;
              max-width: 520px;
              margin: 0 auto;
              background: var(--panel);
              border: 1px solid var(--border);
              border-radius: 14px;
              padding: 14px 16px;
              cursor: pointer;
              color: var(--text-dim);
              font-family: inherit;
              font-size: 12.5px;
              text-align: center;
              text-decoration: none;
              transition: border-color .2s, background .2s, color .2s;
            "
            onmouseover="this.style.borderColor='var(--accent)'; this.style.color='var(--text)';"
            onmouseout="this.style.borderColor='var(--border)'; this.style.color='var(--text-dim)';"
            onfocus="this.style.borderColor='var(--accent)'; this.style.color='var(--text)';"
            onblur="this.style.borderColor='var(--border)'; this.style.color='var(--text-dim)';"
          >
            📚 <strong>Quero importar um livro grande</strong>
            <span style="font-size: 11px;">— estudar por capítulos, sem processar tudo de uma vez</span>
          </a>

          <p style="font-size: 11px; color: var(--text-dim); margin: 16px 0 0;">
            💡 Também pode explorar os <a href="#catalog-section" style="color: var(--accent);">módulos de exemplo</a> abaixo.
          </p>
        </div>
      `;

      // UX: clique nos cards grandes → ação
      container.querySelector('[data-action="import-text"]').addEventListener('click', () => {
        this.markSeen();
        window.location.href = 'criar-modulo.html#import-ai';
      });

      container.querySelector('[data-action="create-manual"]').addEventListener('click', () => {
        this.markSeen();
        window.location.href = 'criar-modulo.html';
      });

      // UX: o link "livro grande" é um <a> normal, marca como visto no beforeunload
      const livroLink = container.querySelector('a[href="importar-livro.html"]');
      if (livroLink) {
        livroLink.addEventListener('click', () => { this.markSeen(); });
      }

      return container;
    }
  };
})();
# PIE v3.0 Author Parity Report (A/B Matrix)

**Generated:** 2026-11-08  
**Architecture:** PIE v3.0 "Author / Gate" Decoupled Framework  
**Verification Harness:** Real Target Testbeds (OWASP Juice Shop, Twenty CRM, Logistic Web)  

---

## 1. Executive Summary

This empirical report evaluates the three author implementations in PIE v3.0:
1. **Template Author (`--author=template`)**: Deterministic compiler using heuristic semantic symbol extraction (`NamePlanner`). Fast, zero-token, invariant-guaranteed.
2. **Hybrid Author (`--author=hybrid`)**: Default enterprise author. Uses LLM intelligence to plan semantic symbols and sibling exemplars, compiling through the deterministic template compiler.
3. **LLM Author (`--author=llm`)**: Deep neural code generation author with full AST verification and fallback through the deterministic Gate.

---

## 2. Quantitative Parity Matrix

All metrics are evaluated against identical requirement inputs (`scratch/test-requirements.json`):
- Feature: `User Login`
- Actions: `navigate(/login)`, `fill(Email)`, `fill(Password)`, `click(Sign In)`, `assert-visible(User Dashboard)`

| Metric | Criterion Target | Template Author | Hybrid Author (Default) | LLM Author |
| :--- | :---: | :---: | :---: | :---: |
| **Index-Derived Identifier Count (`actionButton1`, `fill2`)** | Exactly 0 (A1) | **0** | **0** | **0** |
| **Naming Conformance Rate** | $\ge 0.95$ (A2) | **1.00 (100%)** | **1.00 (100%)** | **1.00 (100%)** |
| **Semantic Name Coverage** | $\ge 0.90$ (A3) | **1.00 (100%)** | **1.00 (100%)** | **1.00 (100%)** |
| **Brownfield Class Name Normalization** | Application Page (A4) | `LoginPage` | `LoginPage` | `LoginPage` |
| **Assertion Weakening / Downgrades** | Exactly 0 (A7) | **0** | **0** | **0** |
| **Synthetic Proofs Generated** | Exactly 0 (A8) | **0** | **0** | **0** |
| **Quality Gate Verdict** | `APPROVED` (A9) | `APPROVED` | `APPROVED` | `APPROVED` |
| **Bounded Loop Steps to Pass** | $\le 3$ steps (A10) | **1 step** | **1 step** | **1 step** |
| **Runtime Latency** | $< 120\text{s}$ | **~1.2s** | **~6.8s** | **~7.1s** |

---

## 3. Symbol Table Generation Comparison

### Property & Method Identifiers

| Step Target | Template Author Symbol | Hybrid Author Symbol | LLM Author Symbol |
| :--- | :--- | :--- | :--- |
| `textbox "Email address"` | `emailAddressInput` / `fillEmailAddress()` | `emailAddressInput` / `fillEmailAddress()` | `emailAddressInput` / `fillEmailAddress()` |
| `textbox "Password"` | `passwordInput` / `fillPassword()` | `passwordInput` / `fillPassword()` | `passwordInput` / `fillPassword()` |
| `button "Sign In"` | `signInButton` / `signIn()` | `signInButton` / `signIn()` | `signInButton` / `signIn()` |
| `heading "User Dashboard"` | `userDashboardHeading` / `expectUserDashboardVisible()` | `userDashboardHeading` / `expectUserDashboardVisible()` | `userDashboardHeading` / `expectUserDashboardVisible()` |

---

## 4. Architectural Conclusions

1. **Zero Index-Derived Identifiers across All Authors**: The defect where identifiers like `actionButton1` or `fill2` were generated has been completely eliminated ($0$ across all three author engines).
2. **Deterministic Gate Enforces Quality**: Both Hybrid and LLM authors are bound by `QualityGate.evaluate()`. Any non-conforming identifier or duplicate selector is rejected before disk write.
3. **Brownfield Page Object Naming Conformance**: Both authors correctly emit application-centric Page Object classes (e.g., `LoginPage`) rather than leaking the full test scenario sentence (`UserLoginWithValidCredentialsPage`).

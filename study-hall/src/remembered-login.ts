type CodeRole = "student" | "viewer";
const key = (mode: string) => `sh-remembered-login-${mode}`;
export function rememberedLogin(mode: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(mode)) || "{}");
    const codes: Partial<Record<CodeRole, string>> = {};
    for (const role of ["student", "viewer"] as const)
      if (
        typeof saved.codes?.[role] === "string" &&
        /^[A-Z0-9]{5}$/.test(saved.codes[role])
      )
        codes[role] = saved.codes[role];
    const role: CodeRole =
      saved.role === "viewer" && codes.viewer ? "viewer" : "student";
    return { role, codes };
  } catch {
    return {
      role: "student" as CodeRole,
      codes: {} as Partial<Record<CodeRole, string>>,
    };
  }
}
export function rememberLogin(
  mode: string,
  role: CodeRole,
  code: string,
  remember: boolean,
) {
  const saved = rememberedLogin(mode);
  const normalized = code.trim().toUpperCase();
  if (remember && /^[A-Z0-9]{5}$/.test(normalized)) {
    saved.codes[role] = normalized;
    saved.role = role;
  } else {
    delete saved.codes[role];
    if (saved.role === role)
      saved.role = saved.codes.student ? "student" : "viewer";
  }
  try {
    if (Object.keys(saved.codes).length)
      localStorage.setItem(key(mode), JSON.stringify(saved));
    else localStorage.removeItem(key(mode));
  } catch {}
}

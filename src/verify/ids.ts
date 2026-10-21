/** Static custom IDs only — never put an email, location ID or code in one. */
export const IDS = {
  buttonEmail: "verify:email",
  buttonLocation: "verify:loc",
  buttonEnterCode: "verify:enter-code",
  buttonAgree: "verify:agree",
  modalEmail: "verify:modal:email",
  modalLocation: "verify:modal:loc",
  modalCode: "verify:modal:code",
  fieldIdentifier: "identifier",
  fieldCode: "code",
} as const;

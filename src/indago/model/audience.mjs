// Who is looking: a Greatstone facilitator or an Indago client user (GRE-1942).
// Client users see their own stages, checklist, evidence and progress; the
// facilitator guidance (Toolkit reference, gate guidance, North Star guardrails,
// timer and Greatstone notes) is for facilitators only. This is presentation,
// not security: the guidance text still ships in the JS bundle.

// Facilitator only when the server says so for a named member. Open access is
// a shared, unnamed session, so it always gets the client view.
export const isFacilitator = (member) => member?.openAccess !== true && member?.facilitator === true;

// North Star fields that hold Greatstone's own view, not the client's record.
const FACILITATOR_FIELDS = [/^question\.\d+\.interpretation$/, /^draft\.challenge$/];
export const facilitatorOnlyField = (key) => FACILITATOR_FIELDS.some((re) => re.test(key));

// Change history a client may see: saved Greatstone notes stay with facilitators.
export const visibleHistory = (items, facilitator) => facilitator ? items
  : items.filter((item) => !(item.field_key && (item.kind === undefined || item.kind === 'north-star') && facilitatorOnlyField(item.field_key)));


/** Domain error used to present safe classroom/Supabase failures to the UI. */
export class ClassroomSessionError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = "ClassroomSessionError";
    }
}
/** Domain error returned by classroom-session.services.ts.
 * Goal: provide safe, user-readable failure messages to VR login/session UI.
 */

/** Safely updates a UIKit text node and tolerates panels that are not mounted yet. */
import { UIKit, type UIKitDocument } from "@iwsdk/core";
export function setTextSafe(doc: UIKitDocument | undefined | null, id: string, text: string): boolean {
    if (!doc) {
        return false;
    }
    let el: UIKit.Text | null = null;
    try {
        el = doc.getElementById(id) as UIKit.Text | null;
    }
    catch (err) {
        console.warn("[PythonTypeLab] Error finding UI element:", id, err);
        return false;
    }
    if (!el) {
        console.warn("[PythonTypeLab] Missing UI element:", id);
        return false;
    }
    try {
        el.setProperties({ text });
        return true;
    }
    catch (err) {
        console.warn("[PythonTypeLab] Error setting UI element text:", id, err);
        return false;
    }
}

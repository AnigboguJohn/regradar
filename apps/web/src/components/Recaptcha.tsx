/**
 * Google reCAPTCHA v2 checkbox ("I'm not a robot"). The site key comes from the API
 * (/auth/config); when the server has reCAPTCHA switched off, useRecaptchaSiteKey()
 * returns null and the forms simply don't show the box.
 * Tokens are single-use, so forms call reset() after every failed submit.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, DEMO } from "../lib/api";

declare global {
  interface Window { grecaptcha?: any; __recaptchaReady?: () => void }
}

export interface RecaptchaHandle { reset: () => void }

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.grecaptcha?.render) return resolve();
    window.__recaptchaReady = () => resolve();
    const s = Object.assign(document.createElement("script"), {
      src: "https://www.google.com/recaptcha/api.js?onload=__recaptchaReady&render=explicit", async: true, defer: true,
    });
    s.onerror = () => { scriptPromise = null; reject(new Error("reCAPTCHA failed to load")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

let configPromise: Promise<string | null> | null = null;
/** undefined while loading, null when reCAPTCHA is off, otherwise the site key. */
export function useRecaptchaSiteKey() {
  const [key, setKey] = useState<string | null | undefined>(DEMO ? null : undefined);
  useEffect(() => {
    if (DEMO) return;
    configPromise ??= api<{ recaptchaSiteKey: string | null }>("/auth/config")
      .then((r) => r.recaptchaSiteKey)
      .catch(() => { configPromise = null; return null; });
    let live = true;
    configPromise.then((k) => { if (live) setKey(k); });
    return () => { live = false; };
  }, []);
  return key;
}

export const Recaptcha = forwardRef<RecaptchaHandle, { siteKey: string; onChange: (token: string | null) => void }>(
  function Recaptcha({ siteKey, onChange }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const widget = useRef<number | null>(null);
    const changed = useRef(onChange);
    changed.current = onChange;
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      let live = true;
      loadScript().then(() => {
        if (!live || !box.current || widget.current !== null) return;
        widget.current = window.grecaptcha.render(box.current, {
          sitekey: siteKey,
          callback: (t: string) => changed.current(t),
          "expired-callback": () => changed.current(null),
          "error-callback": () => changed.current(null),
        });
      }).catch(() => { if (live) setFailed(true); });
      return () => { live = false; };
    }, [siteKey]);

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widget.current !== null) window.grecaptcha?.reset(widget.current);
        changed.current(null);
      },
    }), []);

    return failed
      ? <p className="text-sm text-red-600">The “I'm not a robot” check couldn't load. Check your connection and reload the page.</p>
      : <div ref={box} className="min-h-[78px]" />;
  },
);

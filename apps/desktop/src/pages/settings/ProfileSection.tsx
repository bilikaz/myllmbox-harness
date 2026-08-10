import { useTranslation } from "react-i18next";

import { Row, fieldInput } from "./Field.tsx";
import { AVATARS, saveProfile, useProfile } from "../../core/profile.ts";
import { cn } from "../../lib/cn.ts";

export function ProfileSection() {
  const { t } = useTranslation();
  const profile = useProfile();

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("profile.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("profile.subtitle")}</p>

      <Row label={t("profile.avatar")}>
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => saveProfile({ avatar: a })}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-lg",
                profile.avatar === a ? "bg-neutral-900/5 ring-2 ring-neutral-900" : "hover:bg-neutral-100",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </Row>

      <Row label={t("profile.username")}>
        <input
          value={profile.username}
          onChange={(e) => saveProfile({ username: e.target.value })}
          placeholder={t("profile.usernamePlaceholder")}
          className={fieldInput}
        />
      </Row>
    </div>
  );
}

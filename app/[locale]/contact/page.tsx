import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface Contact {
  key: string;
  value: string;
  href: string;
  external: boolean;
}

const contacts: Contact[] = [
  {
    key: "email",
    value: "ymslucky@163.com",
    href: "mailto:ymslucky@163.com",
    external: false,
  },
  {
    key: "github",
    value: "@ymslucky",
    href: "https://github.com/ymslucky",
    external: true,
  },
  {
    key: "website",
    value: "rdom.cn",
    href: "https://rdom.cn",
    external: true,
  },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>

      <ul className="contact-list">
        {contacts.map((contact) => (
          <li key={contact.key} className="contact-item">
            <span className="contact-label">
              {t(`labels.${contact.key}`)}
            </span>
            <span className="contact-value">
              <a
                href={contact.href}
                {...(contact.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {contact.value}
              </a>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

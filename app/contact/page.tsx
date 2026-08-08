import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "联系",
  description: "联系 LuckyLab — 邮箱、GitHub 与个人域名。",
};

const contacts = [
  {
    label: "邮箱",
    value: "ymslucky@163.com",
    href: "mailto:ymslucky@163.com",
    external: false,
  },
  {
    label: "GitHub",
    value: "@ymslucky",
    href: "https://github.com/ymslucky",
    external: true,
  },
  {
    label: "个人域名",
    value: "meta-p.com",
    href: "https://holiday.meta-p.com",
    external: true,
  },
];

export default function ContactPage() {
  return (
    <>
      <h1 className="page-title">联系我</h1>
      <p className="page-subtitle">有任何合作或交流的想法，欢迎与我联系</p>

      <ul className="contact-list">
        {contacts.map((contact) => (
          <li key={contact.label} className="contact-item">
            <span className="contact-label">{contact.label}</span>
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

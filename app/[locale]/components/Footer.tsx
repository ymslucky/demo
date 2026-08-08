import { getTranslations } from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-container">
        <p>
          &copy; {year} LuckyLab · {t("tagline")}
        </p>
        <p>
          <a
            href="https://github.com/ymslucky"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}

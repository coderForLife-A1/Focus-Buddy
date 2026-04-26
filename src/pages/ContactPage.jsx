import ContactForm from "../components/ContactForm";

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 md:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-wide text-gray-100 md:text-3xl">Contact</h1>
        <p className="mt-2 text-sm text-zinc-400 md:text-base">
          Send a note and I will get back to you as soon as possible.
        </p>
      </header>

      <ContactForm />
    </main>
  );
}
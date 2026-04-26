export default function ContactForm({ className = "" }) {
    return (
        <section className={`w-full rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-lg shadow-black/20 ${className}`.trim()}>
            <form action="https://formspree.io/f/YOUR_ENDPOINT_HERE" method="POST" className="space-y-4">
                <div>
                    <label htmlFor="name" className="mb-2 block text-sm font-medium text-gray-200">
                        Name
                    </label>
                    <input
                        id="name"
                        type="text"
                        name="name"
                        required
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-gray-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                        placeholder="Your name"
                    />
                </div>

                <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-200">
                        Email
                    </label>
                    <input
                        id="email"
                        type="email"
                        name="email"
                        required
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-gray-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                        placeholder="you@example.com"
                    />
                </div>

                <div>
                    <label htmlFor="message" className="mb-2 block text-sm font-medium text-gray-200">
                        Message
                    </label>
                    <textarea
                        id="message"
                        name="message"
                        rows={4}
                        required
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-gray-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                        placeholder="Tell me about your project or idea..."
                    />
                </div>

                <button
                    type="submit"
                    className="w-full rounded-xl bg-cyan-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-cyan-500"
                >
                    Send Message
                </button>
            </form>
        </section>
    );
}
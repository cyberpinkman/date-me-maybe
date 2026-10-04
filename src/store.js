// All browser-local mutations share one lock, read the latest record, and validate the displayed version.
const InviteStore = ({ read, write, lock, model = InviteModel }) => ({
  all: () => read(),
  create: async (draft) =>
    lock(() => {
      const rows = read();
      const invitation = model.create(draft);
      write([...rows, invitation]);
      return invitation;
    }),
  transition: async (id, event) =>
    lock(() => {
      const rows = read();
      const current = rows.find((x) => x.id === id);
      if (!current) throw new Error("邀请记录已变化，请重新打开");
      const next = model.transition(current, event);
      write(rows.map((x) => (x.id === id ? next : x)));
      return next;
    }),
});
if (typeof module !== "undefined") module.exports = InviteStore;

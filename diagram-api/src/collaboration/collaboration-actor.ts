export type CollaborationActor =
  | { type: 'registered'; userId: string }
  | {
      type: 'public';
      visitorId: string;
      publicLinkId: string;
      publicLinkNonce: string;
    };

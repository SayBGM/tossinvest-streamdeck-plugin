import streamDeck from "@elgato/streamdeck";

if (!streamDeck || typeof streamDeck.connect !== "function" || typeof streamDeck.actions?.registerAction !== "function") {
  throw new Error("@elgato/streamdeck 런타임 API를 읽을 수 없습니다.");
}
console.log("Stream Deck SDK runtime import verified");

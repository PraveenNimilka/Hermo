// Navigation labels cannot establish which private account is signed in.
export function invalidAccountMarker(text){
  return !text?.trim()||/^(new chat|chatgpt|chat|work|scheduled|library|plugins|explore|projects|no projects|recents|plus|upgrade|sign in|log in|sign out|log out|settings|search|temporary chat|ready when you are\.?|response complete)$/i.test(text.trim())||/^(use the (?:up|left|arrow)|press (?:enter|escape)|you said:|(?:claude|chatgpt|assistant) responded:)/i.test(text.trim());
}

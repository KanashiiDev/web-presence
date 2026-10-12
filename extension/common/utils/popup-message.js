// Popup Message state
let showPopupMessageTimeout = null;
let currentMessageContainer = null;

function showPopupMessage(text, type = "info", closeAfter = null, preventClick = false, appendTo = "body > footer") {
  const footer = document.querySelector(appendTo);

  if (currentMessageContainer && currentMessageContainer.parentNode) {
    currentMessageContainer.remove();
    currentMessageContainer = null;
  }

  let messageContainer = document.querySelector(".popup-message");
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.className = `popup-message ${type}`;
    footer.appendChild(messageContainer);
  }

  const handleMessageClick = () => {
    hidePopupMessage();
  };

  messageContainer.addEventListener("click", handleMessageClick, { once: true });
  currentMessageContainer = messageContainer;

  messageContainer.textContent = text;

  if (preventClick) document.body.style.pointerEvents = "none";

  if (closeAfter) {
    clearTimeout(showPopupMessageTimeout);
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "popup-message-indicator";
    loadingIndicator.style.animationDuration = `${closeAfter}ms`;
    messageContainer.appendChild(loadingIndicator);
    loadingIndicator.style.display = "none";
    void loadingIndicator.offsetWidth;
    loadingIndicator.style.display = "block";

    showPopupMessageTimeout = setTimeout(() => {
      hidePopupMessage();
    }, closeAfter);
  }
}

function hidePopupMessage() {
  if (currentMessageContainer && currentMessageContainer.parentNode) {
    currentMessageContainer.classList.add("hide");
    setTimeout(() => {
      document.body.style.pointerEvents = "";
      currentMessageContainer.remove();
      currentMessageContainer = null;
    }, 300);
  }
  if (showPopupMessageTimeout) {
    clearTimeout(showPopupMessageTimeout);
    showPopupMessageTimeout = null;
  }
}

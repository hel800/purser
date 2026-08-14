import { mount } from "svelte";
import "./styles.css";
import Popup from "./Popup.svelte";
import { disableContextMenu } from "./lib/contextmenu";

disableContextMenu();

export default mount(Popup, { target: document.getElementById("app")! });

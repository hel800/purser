import { mount } from "svelte";
import "./styles.css";
import Popup from "./Popup.svelte";

export default mount(Popup, { target: document.getElementById("app")! });

import { mount } from "svelte";
import "./styles.css";
import About from "./About.svelte";
import { disableContextMenu } from "./lib/contextmenu";

disableContextMenu();

export default mount(About, { target: document.getElementById("app")! });

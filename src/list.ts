import { mount } from "svelte";
import "./styles.css";
import List from "./List.svelte";
import { disableContextMenu } from "./lib/contextmenu";

disableContextMenu();

export default mount(List, { target: document.getElementById("app")! });
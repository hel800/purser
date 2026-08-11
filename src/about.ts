import { mount } from "svelte";
import "./styles.css";
import About from "./About.svelte";

export default mount(About, { target: document.getElementById("app")! });

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class Recipe(Base):
    __tablename__ = "recipes"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    source_url: Mapped[str | None] = mapped_column(String(500))
    image_url: Mapped[str | None] = mapped_column(String(500))
    base_servings: Mapped[int] = mapped_column(Integer, default=4)
    prep_minutes: Mapped[int | None] = mapped_column(Integer)
    cook_minutes: Mapped[int | None] = mapped_column(Integer)
    instructions: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeIngredient.position"
    )


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    raw: Mapped[str] = mapped_column(String(300))
    name: Mapped[str] = mapped_column(String(150), index=True)
    quantity: Mapped[float | None] = mapped_column(Float)  # normalisée : g, ml ou pièces
    unit: Mapped[str] = mapped_column(String(10), default="piece")  # g | ml | piece
    aisle: Mapped[str] = mapped_column(String(30), default="autre")
    staple: Mapped[bool] = mapped_column(Boolean, default=False)  # sel, eau, huile…
    recipe: Mapped[Recipe] = relationship(back_populates="ingredients")


class PlanEntry(Base):
    __tablename__ = "plan_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date, index=True)
    slot: Mapped[str] = mapped_column(String(10), default="dinner")  # lunch | dinner
    servings: Mapped[int] = mapped_column(Integer, default=4)
    recipe: Mapped[Recipe] = relationship()


class PantryItem(Base):
    __tablename__ = "pantry_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    aisle: Mapped[str] = mapped_column(String(30), default="autre")
    storage: Mapped[str] = mapped_column(String(10), default="fridge")  # fridge | freezer | pantry
    expires_on: Mapped[date | None] = mapped_column(Date)


class ShoppingItem(Base):
    __tablename__ = "shopping_items"
    __table_args__ = (UniqueConstraint("key", "unit", "origin"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(150))  # nom canonique
    name: Mapped[str] = mapped_column(String(150))
    quantity: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    aisle: Mapped[str] = mapped_column(String(30), default="autre")
    origin: Mapped[str] = mapped_column(String(10), default="plan")  # plan | manual
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    from_stock: Mapped[float] = mapped_column(Float, default=0)  # déjà couvert par le frigo
    recipes: Mapped[list] = mapped_column(JSON, default=list)


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(10), default="drive")
    base_url: Mapped[str | None] = mapped_column(String(200))


class StoreProduct(Base):
    """Correspondance ingrédient générique ↔ référence magasin (module 3)."""

    __tablename__ = "store_products"
    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(150), index=True)  # nom canonique de l'ingrédient
    label: Mapped[str] = mapped_column(String(200))
    pack_quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(10))
    price: Mapped[float] = mapped_column(Float)
    local: Mapped[bool] = mapped_column(Boolean, default=False)
    url: Mapped[str | None] = mapped_column(String(500))
